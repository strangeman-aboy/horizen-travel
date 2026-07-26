import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { URL } from "node:url";
import {
  IdempotencyConflictError,
  RevisionConflictError,
  TripStatusConflictError
} from "./store.js";
import { AgentRunError, createAgentManager } from "./agent-manager.js";
import { createUnavailableAgentProvider } from "./agent-provider.js";
import { createLocalProviderAdapters } from "./providers.js";
import { openApiDocument } from "./openapi.js";

const API_PREFIX = "/api/v1";
const JSON_LIMIT_BYTES = 1_000_000;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SUPPORTED_COORD_SYSTEMS = ["WGS84", "GCJ02", "BD09", "BD09LL"];
const PUBLIC_PATHS = new Set(["/health", "/livez", "/readyz", "/openapi.json"]);
const USER_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:@-]{0,127})$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/;

class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function parsePagination(url, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const parse = (name, fallback, { min, max }) => {
    const raw = url.searchParams.get(name);
    if (raw == null || raw === "") return fallback;
    if (!/^\d+$/.test(raw)) {
      throw new ApiError(400, "VALIDATION_ERROR", `${name} must be an integer.`, [
        { field: name, min, max }
      ]);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new ApiError(400, "VALIDATION_ERROR", `${name} is outside the supported range.`, [
        { field: name, min, max }
      ]);
    }
    return value;
  };
  return {
    limit: parse("limit", defaultLimit, { min: 1, max: maxLimit }),
    offset: parse("offset", 0, { min: 0, max: 1_000_000 })
  };
}

function normalizeRequestId(value) {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value)
    ? value
    : randomUUID();
}

function equalSecret(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function resolvePrincipal(request, { authMode, serviceToken }) {
  if (authMode === "demo") {
    return { userId: "demo-user", authMode: "demo" };
  }
  if (authMode !== "service-token") {
    throw new ApiError(500, "AUTH_CONFIGURATION_ERROR", "Unsupported authentication mode.");
  }

  const authorization = request.headers.authorization ?? "";
  const match = authorization.match(/^Bearer (.+)$/i);
  if (!match || !equalSecret(match[1], serviceToken)) {
    throw new ApiError(401, "AUTHENTICATION_REQUIRED", "A valid service bearer token is required.");
  }
  const userId = request.headers["x-user-id"];
  if (typeof userId !== "string" || !USER_ID_PATTERN.test(userId)) {
    throw new ApiError(
      400,
      "INVALID_PRINCIPAL",
      "X-User-Id must contain a trusted stable application user id."
    );
  }
  return { userId, authMode: "service-token" };
}

function extractBaseRevisionId(request, body) {
  const rawIfMatch = request.headers["if-match"];
  let headerRevisionId = null;
  if (rawIfMatch != null) {
    if (
      typeof rawIfMatch !== "string" ||
      rawIfMatch.includes(",") ||
      rawIfMatch.trim() === "*"
    ) {
      throw new ApiError(
        400,
        "INVALID_IF_MATCH",
        "If-Match must contain exactly one quoted trip revision id."
      );
    }
    const match = rawIfMatch.trim().match(/^(?:W\/)?"([^"]+)"$/);
    if (!match) {
      throw new ApiError(
        400,
        "INVALID_IF_MATCH",
        "If-Match must contain exactly one quoted trip revision id."
      );
    }
    headerRevisionId = match[1];
  }

  const bodyRevisionId = body.baseRevisionId ?? body.revisionId ?? null;
  if (
    headerRevisionId &&
    bodyRevisionId &&
    headerRevisionId !== bodyRevisionId
  ) {
    throw new ApiError(
      400,
      "REVISION_PRECONDITION_MISMATCH",
      "If-Match and body.baseRevisionId must refer to the same revision."
    );
  }
  return requireString(bodyRevisionId ?? headerRevisionId, "baseRevisionId", { max: 120 });
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, field = "body") {
  if (!isObject(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a JSON object.`, [{ field }]);
  }
  return value;
}

function requireString(value, field, { min = 1, max = 500 } = {}) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `${field} must be a string between ${min} and ${max} characters.`,
      [{ field }]
    );
  }
  return value.trim();
}

function optionalString(value, field, options) {
  if (value == null || value === "") return null;
  return requireString(value, field, options);
}

function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `${field} must be one of: ${allowed.join(", ")}.`,
      [{ field, allowed }]
    );
  }
  return value;
}

function validatePlannerState(value) {
  requireObject(value, "plannerState");
  const allowedKeys = new Set(["constraints", "transportModeOverrides"]);
  const unexpectedKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "plannerState contains unsupported fields.",
      [{ field: "plannerState", unexpectedKeys }]
    );
  }
  const constraints = value.constraints ?? [];
  if (!Array.isArray(constraints) || constraints.length > 50) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "plannerState.constraints must be an array with at most 50 items.",
      [{ field: "plannerState.constraints", maxItems: 50 }]
    );
  }
  constraints.forEach((constraint, index) => {
    if (!isObject(constraint) || JSON.stringify(constraint).length > 2_000) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `plannerState.constraints[${index}] must be a small JSON object.`,
        [{ field: `plannerState.constraints[${index}]`, maxBytes: 2_000 }]
      );
    }
  });
  const transportModeOverrides = value.transportModeOverrides ?? {};
  if (!isObject(transportModeOverrides) || Object.keys(transportModeOverrides).length > 100) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "plannerState.transportModeOverrides must be an object with at most 100 entries.",
      [{ field: "plannerState.transportModeOverrides", maxProperties: 100 }]
    );
  }
  for (const [key, mode] of Object.entries(transportModeOverrides)) {
    if (
      key.length === 0 ||
      key.length > 240 ||
      typeof mode !== "string" ||
      mode.length === 0 ||
      mode.length > 32
    ) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "plannerState.transportModeOverrides contains an invalid key or mode.",
        [{ field: `plannerState.transportModeOverrides.${key}` }]
      );
    }
  }
  const normalized = { constraints, transportModeOverrides };
  if (JSON.stringify(normalized).length > 50_000) {
    throw new ApiError(
      413,
      "PLANNER_STATE_TOO_LARGE",
      "plannerState must not exceed 50 KB."
    );
  }
  return structuredClone(normalized);
}

function requireTimezone(value, field = "timezone") {
  const timezone = requireString(value, field, { max: 80 });
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a valid IANA timezone.`, [
      { field }
    ]);
  }
  return timezone;
}

function requireTimestamp(value, field) {
  const text = requireString(value, field, { max: 80 });
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
  ) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be an RFC 3339 timestamp.`, [
      { field }
    ]);
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a valid timestamp.`, [
      { field }
    ]);
  }
  return parsed;
}

function validateTripSource(value, fallback = {}) {
  if (value == null) return fallback ?? {};
  const source = requireObject(value, "source");
  const normalized = {
    platform: optionalString(source.platform, "source.platform", { max: 80 }),
    handoffMode: optionalString(source.handoffMode, "source.handoffMode", { max: 80 }),
    collaborationMode: optionalString(
      source.collaborationMode,
      "source.collaborationMode",
      { max: 120 }
    ),
    providerContentId: optionalString(
      source.providerContentId,
      "source.providerContentId",
      { max: 240 }
    ),
    label: optionalString(source.label, "source.label", { max: 240 }),
    authorName: optionalString(source.authorName, "source.authorName", { max: 160 }),
    capturedAt: source.capturedAt == null
      ? null
      : requireTimestamp(source.capturedAt, "source.capturedAt").toISOString()
  };
  return Object.fromEntries(
    Object.entries(normalized).filter(([, fieldValue]) => fieldValue !== null)
  );
}

function validateProviderRefs(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 10) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be an array with at most 10 items.`, [
      { field }
    ]);
  }
  const seen = new Set();
  return value.map((raw, index) => {
    const reference = requireObject(raw, `${field}[${index}]`);
    const provider = requireString(reference.provider, `${field}[${index}].provider`, {
      max: 80
    }).toLocaleLowerCase("en-US");
    const providerPlaceId = requireString(
      reference.providerPlaceId,
      `${field}[${index}].providerPlaceId`,
      { max: 240 }
    );
    if (seen.has(provider)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `${field} cannot contain the same provider twice.`,
        [{ field: `${field}[${index}].provider` }]
      );
    }
    seen.add(provider);
    return { provider, providerPlaceId };
  });
}

function requireUrl(value, field, allowedHosts = null) {
  const text = requireString(value, field, { min: 8, max: 2_000 });
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a valid URL.`, [{ field }]);
  }
  if (parsed.protocol !== "https:") {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must use https.`, [{ field }]);
  }
  if (allowedHosts && !allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `${field} must point to a supported user-shared source.`,
      [{ field, allowedHosts }]
    );
  }
  return parsed.toString();
}

function isValidTime(value) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  return Number(value.slice(3, 5)) % 15 === 0;
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function optionalCoordinate(value, field, { min, max }) {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `${field} must be a finite number between ${min} and ${max}.`,
      [{ field, min, max }]
    );
  }
  return value;
}

function validateStops(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "stops must contain between 1 and 20 items.",
      [{ field: "stops" }]
    );
  }

  const ids = new Set();
  const times = new Set();
  const stops = value.map((raw, index) => {
    const stop = requireObject(raw, `stops[${index}]`);
    const clientStopId = requireString(stop.clientStopId ?? stop.id, `stops[${index}].clientStopId`, {
      max: 120
    });
    if (ids.has(clientStopId)) {
      throw new ApiError(400, "VALIDATION_ERROR", "clientStopId values must be unique.", [
        { field: `stops[${index}].clientStopId` }
      ]);
    }
    ids.add(clientStopId);

    const scheduledTime = requireString(
      stop.scheduledTime ?? stop.suggestedTime,
      `stops[${index}].scheduledTime`,
      { min: 5, max: 5 }
    );
    if (!isValidTime(scheduledTime)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `stops[${index}].scheduledTime must be HH:mm on a 15-minute boundary.`,
        [{ field: `stops[${index}].scheduledTime` }]
      );
    }
    if (times.has(scheduledTime)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Two stops cannot have the same start time.", [
        { field: `stops[${index}].scheduledTime` }
      ]);
    }
    times.add(scheduledTime);

    const durationMinutes = Number(stop.durationMinutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 720) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `stops[${index}].durationMinutes must be an integer between 15 and 720.`,
        [{ field: `stops[${index}].durationMinutes` }]
      );
    }
    if (stop.locked != null && typeof stop.locked !== "boolean") {
      throw new ApiError(400, "VALIDATION_ERROR", `stops[${index}].locked must be boolean.`, [
        { field: `stops[${index}].locked` }
      ]);
    }

    const latitude = optionalCoordinate(
      stop.latitude ?? stop.lat,
      `stops[${index}].latitude`,
      { min: -90, max: 90 }
    );
    const longitude = optionalCoordinate(
      stop.longitude ?? stop.lng,
      `stops[${index}].longitude`,
      { min: -180, max: 180 }
    );
    const coordSystem = optionalString(
      stop.coordSystem,
      `stops[${index}].coordSystem`,
      { max: 32 }
    );
    if ((latitude === null) !== (longitude === null)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `stops[${index}] must provide latitude and longitude together.`,
        [{ field: `stops[${index}]`, requiredTogether: ["latitude", "longitude"] }]
      );
    }
    if (latitude !== null && coordSystem === null) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `stops[${index}].coordSystem is required when coordinates are provided.`,
        [{ field: `stops[${index}].coordSystem`, allowed: SUPPORTED_COORD_SYSTEMS }]
      );
    }
    if (coordSystem !== null && latitude === null) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `stops[${index}].coordSystem requires latitude and longitude.`,
        [{ field: `stops[${index}].coordSystem` }]
      );
    }
    if (coordSystem !== null) {
      requireEnum(coordSystem, `stops[${index}].coordSystem`, SUPPORTED_COORD_SYSTEMS);
    }

    return {
      clientStopId,
      sourceStopId: optionalString(
        stop.sourceStopId,
        `stops[${index}].sourceStopId`,
        { max: 240 }
      ),
      placeId: optionalString(stop.placeId, `stops[${index}].placeId`, { max: 120 }),
      providerRefs: validateProviderRefs(
        stop.providerRefs,
        `stops[${index}].providerRefs`
      ),
      name: requireString(stop.name, `stops[${index}].name`, { max: 120 }),
      scheduledTime,
      durationMinutes,
      note: optionalString(stop.note, `stops[${index}].note`, { max: 2_000 }) ?? "",
      address: optionalString(stop.address, `stops[${index}].address`, { max: 500 }) ?? "",
      latitude,
      longitude,
      coordSystem,
      imageUrl: optionalString(stop.imageUrl, `stops[${index}].imageUrl`, { max: 2_000 }),
      category: optionalString(stop.category, `stops[${index}].category`, { max: 120 }),
      locked: Boolean(stop.locked)
    };
  });

  const ordered = [...stops].sort(
    (left, right) => timeToMinutes(left.scheduledTime) - timeToMinutes(right.scheduledTime)
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (timeToMinutes(previous.scheduledTime) + previous.durationMinutes > timeToMinutes(current.scheduledTime)) {
      throw new ApiError(400, "SCHEDULE_OVERLAP", "Schedule items must not overlap.", [
        { before: previous.clientStopId, after: current.clientStopId }
      ]);
    }
  }
  return ordered;
}

function compactTrip(trip) {
  return {
    tripId: trip.tripId,
    revisionId: trip.revisionId,
    revision: trip.revision,
    status: trip.status,
    plannerState: trip.plannerState,
    savedAt: trip.savedAt
  };
}

function expandRoute(route, store) {
  return {
    ...route,
    stops: route.stops.map((stop) => ({
      ...stop,
      place: store.getPlace(stop.placeId)
    }))
  };
}

function routeStopsToTripStops(route, store) {
  return route.stops.map((stop) => {
    const place = store.getPlace(stop.placeId);
    return {
      clientStopId: stop.id,
      sourceStopId: stop.id,
      placeId: stop.placeId,
      providerRefs: place.baiduProviderId
        ? [{ provider: "baidu", providerPlaceId: place.baiduProviderId }]
        : [],
      name: place.name,
      scheduledTime: stop.suggestedTime,
      durationMinutes: stop.durationMinutes,
      note: stop.note,
      address: place.address ?? "",
      latitude: place.lat ?? place.latitude ?? null,
      longitude: place.lng ?? place.longitude ?? null,
      coordSystem: place.coordSystem ?? null,
      imageUrl: place.imageUrl ?? null,
      category: place.category ?? null,
      locked: Boolean(stop.locked)
    };
  });
}

function importStopsToTripStops(stops, store) {
  return stops.map((stop) => {
    const place = stop.placeId ? store.getPlace(stop.placeId) : null;
    return {
      clientStopId: stop.id,
      sourceStopId: stop.id,
      placeId: stop.placeId ?? place?.id ?? null,
      providerRefs: stop.providerRefs ??
        (place?.baiduProviderId
          ? [{ provider: "baidu", providerPlaceId: place.baiduProviderId }]
          : []),
      name: stop.name,
      scheduledTime: stop.suggestedTime,
      durationMinutes: stop.durationMinutes,
      note: stop.note ?? "",
      address: stop.address ?? place?.address ?? "",
      latitude: stop.latitude ?? stop.lat ?? place?.latitude ?? place?.lat ?? null,
      longitude: stop.longitude ?? stop.lng ?? place?.longitude ?? place?.lng ?? null,
      coordSystem: stop.coordSystem ?? place?.coordSystem ?? null,
      imageUrl: stop.imageUrl ?? place?.imageUrl ?? null,
      category: stop.category ?? place?.category ?? null,
      locked: Boolean(stop.locked)
    };
  });
}

function createRouteTable(
  providerAdapters,
  { isDraining = () => false, agentManager } = {}
) {
  const routes = [];
  const add = (method, pattern, handler, { prepare = null } = {}) => {
    routes.push({ method, pattern, handler, prepare });
  };

  add("GET", "/health", ({ store }) => ({
    status: 200,
    body: {
      status: "ok",
      service: "route-story-hackathon-api",
      version: "0.2.0",
      persistence: "sqlite",
      schemaVersion: store.schemaVersion,
      auth: "request-scoped-principal",
      providers: {
        xiaohongshu:
          providerAdapters.catalog().providers.find(
            (provider) => provider.id === "xiaohongshu"
          )?.mode ?? "USER_HANDOFF_MOCK_NO_PARTNERSHIP",
        baidu: "LOCAL_PROVIDER_MOCK_NO_PARTNERSHIP",
        meituan: "BOOKING_PLACEHOLDER_NO_PARTNERSHIP"
      },
      seed: {
        routes: store.listRoutes().length,
        places: store.listPlaces().length
      },
      time: new Date().toISOString()
    }
  }));

  add("GET", "/livez", () => ({
    status: 200,
    body: { status: "alive", time: new Date().toISOString() }
  }));

  add("GET", "/readyz", ({ store }) => {
    const database = store.checkHealth();
    const draining = Boolean(isDraining());
    const ready = database.ok && !draining;
    return {
      status: ready ? 200 : 503,
      body: {
        status: ready ? "ready" : "not_ready",
        draining,
        database,
        providers: providerAdapters.catalog().providers,
        time: new Date().toISOString()
      }
    };
  });

  add("GET", "/providers", () => ({
    status: 200,
    body: providerAdapters.catalog()
  }));

  add("GET", "/openapi.json", () => ({
    status: 200,
    body: openApiDocument
  }));

  add("GET", "/places", ({ store, url }) => {
    const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase("zh-CN");
    const city = (url.searchParams.get("city") ?? "").trim();
    const places = store.listPlaces().filter((place) => {
      const matchesQuery =
        !query ||
        [place.name, place.address, place.category, place.note]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(query);
      return matchesQuery && (!city || place.city === city);
    });
    return { status: 200, body: { items: places, total: places.length } };
  });

  add("GET", "/places/:placeId", ({ store, params }) => {
    const place = store.getPlace(params.placeId);
    if (!place) throw new ApiError(404, "PLACE_NOT_FOUND", "Place not found.");
    return { status: 200, body: place };
  });

  add("GET", "/routes", ({ store, url }) => {
    const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase("zh-CN");
    const city = (url.searchParams.get("city") ?? "").trim();
    const routes = store.listRoutes().filter((route) => {
      const matchesQuery = !query || [route.title, route.summary, route.creator.name]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(query);
      return matchesQuery && (!city || route.city === city);
    }).map((route) => expandRoute(route, store));
    return { status: 200, body: { items: routes, total: routes.length } };
  });

  add("GET", "/routes/:routeId", ({ store, params }) => {
    const route = store.getRoute(params.routeId);
    if (!route) throw new ApiError(404, "ROUTE_NOT_FOUND", "Route not found.");
    return { status: 200, body: expandRoute(route, store) };
  });

  add("GET", "/imports", ({ store, principal, url }) => {
    const pagination = parsePagination(url);
    const result = store.listImports(principal.userId, pagination);
    return {
      status: 200,
      body: { ...result, limit: pagination.limit, offset: pagination.offset }
    };
  });

  const parseXiaohongshuImport = (body) => {
    requireObject(body);
    const shareUrl = requireUrl(
      body.shareUrl,
      "shareUrl",
      ["xiaohongshu.com", "xhslink.com"]
    );
    const hostname = new URL(shareUrl).hostname.toLowerCase();
    if (![
      "xiaohongshu.com",
      "www.xiaohongshu.com",
      "xhslink.com",
      "www.xhslink.com"
    ].includes(hostname)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "shareUrl must use an official Xiaohongshu share host.",
        [{ field: "shareUrl" }]
      );
    }
    requireEnum(body.handoffMode, "handoffMode", ["USER_INITIATED"]);
    const shareText = optionalString(body.shareText, "shareText", {
      max: 12_000
    }) ?? "";
    return { shareUrl, shareText };
  };

  add(
    "POST",
    "/imports/xiaohongshu",
    ({ body, principal, prepared }) => {
      const { shareUrl, shareText } = parseXiaohongshuImport(body);
      return {
        status: 201,
        body: providerAdapters.xiaohongshu.importShare({
          shareUrl,
          shareText,
          prepared,
          ownerUserId: principal.userId
        })
      };
    },
    {
      prepare: async ({ body, principal }) => {
        const { shareUrl, shareText } = parseXiaohongshuImport(body);
        return providerAdapters.xiaohongshu.prepareShare({
          shareUrl,
          shareText,
          ownerUserId: principal.userId
        });
      }
    }
  );

  add("GET", "/imports/:importId", ({ store, params, principal }) => {
    const record = store.getImport(params.importId, principal.userId);
    if (!record) throw new ApiError(404, "IMPORT_NOT_FOUND", "Import not found.");
    return { status: 200, body: record };
  });

  add("GET", "/trips", ({ store, principal, url }) => {
    const pagination = parsePagination(url);
    const status = url.searchParams.get("status");
    const normalizedStatus = status == null || status === ""
      ? null
      : requireEnum(status, "status", ["DRAFT", "CONFIRMED", "READY"]);
    const result = store.listTrips(principal.userId, {
      ...pagination,
      status: normalizedStatus
    });
    return {
      status: 200,
      body: { ...result, limit: pagination.limit, offset: pagination.offset }
    };
  });

  add("POST", "/trips", ({ store, body, principal }) => {
    requireObject(body);
    const sourceImportId = optionalString(body.sourceImportId, "sourceImportId", { max: 120 });
    const sourceRouteId = optionalString(body.sourceRouteId, "sourceRouteId", { max: 120 });
    if (sourceImportId && sourceRouteId) {
      throw new ApiError(
        400,
        "AMBIGUOUS_TRIP_SOURCE",
        "Use either sourceImportId or sourceRouteId, not both."
      );
    }
    const sourceImport = sourceImportId
      ? store.getImport(sourceImportId, principal.userId)
      : null;
    if (sourceImportId && !sourceImport) {
      throw new ApiError(404, "IMPORT_NOT_FOUND", "sourceImportId does not exist.");
    }
    const sourceRoute = sourceRouteId ? store.getRoute(sourceRouteId) : null;
    if (sourceRouteId && !sourceRoute) {
      throw new ApiError(404, "ROUTE_NOT_FOUND", "sourceRouteId does not exist.");
    }

    let rawStops = body.stops;
    if (!rawStops && sourceImport) rawStops = importStopsToTripStops(sourceImport.extraction.stops, store);
    if (!rawStops && sourceRoute) rawStops = routeStopsToTripStops(sourceRoute, store);
    const stops = validateStops(rawStops);

    const title = requireString(body.title ?? sourceImport?.extraction.title ?? sourceRoute?.title, "title", {
      max: 160
    });
    const city = requireString(body.city ?? sourceImport?.extraction.city ?? sourceRoute?.city, "city", {
      max: 80
    });
    const timezone = requireTimezone(
      body.timezone ?? sourceRoute?.timezone ?? "Asia/Shanghai"
    );
    const status = requireEnum(body.status ?? "DRAFT", "status", ["DRAFT", "CONFIRMED", "READY"]);
    const plannerState = body.plannerState == null
      ? { constraints: [], transportModeOverrides: {} }
      : validatePlannerState(body.plannerState);
    const sourceUrl = body.sourceUrl
      ? requireUrl(body.sourceUrl, "sourceUrl")
      : sourceImport?.source.sourceUrl ?? null;
    const derivedSource = sourceImport
      ? {
          platform: sourceImport.source.platform,
          handoffMode: "USER_INITIATED",
          collaborationMode: sourceImport.source.collaborationMode,
          label: sourceImport.source.label,
          authorName: sourceImport.source.authorName,
          capturedAt: sourceImport.source.capturedAt
        }
      : sourceRoute
        ? {
            platform: "ROUTE_STORY",
            handoffMode: "IN_APP_TEMPLATE",
            providerContentId: sourceRoute.id,
            label: sourceRoute.title,
            authorName: sourceRoute.creator?.name
          }
        : { platform: "IN_APP", handoffMode: "DIRECT" };
    const source = validateTripSource(body.source, derivedSource);
    const trip = store.createTrip({
      tripId: `trip-${randomUUID()}`,
      ownerUserId: principal.userId,
      title,
      city,
      timezone,
      status,
      sourceImportId,
      sourceUrl,
      source,
      plannerState,
      stops
    });
    return { status: 201, body: compactTrip(trip) };
  });

  add("GET", "/trips/:tripId", ({ store, params, principal }) => {
    const trip = store.getTrip(params.tripId, principal.userId);
    if (!trip) throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
    return { status: 200, body: trip, headers: { ETag: `"${trip.revisionId}"` } };
  });

  add("GET", "/trips/:tripId/revisions", ({ store, params, principal, url }) => {
    const pagination = parsePagination(url);
    const result = store.listTripRevisions(
      params.tripId,
      principal.userId,
      pagination
    );
    if (!result) throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
    return {
      status: 200,
      body: {
        tripId: params.tripId,
        ...result,
        limit: pagination.limit,
        offset: pagination.offset
      }
    };
  });

  add(
    "GET",
    "/trips/:tripId/revisions/:revisionId",
    ({ store, params, principal }) => {
      const trip = store.getTrip(params.tripId, principal.userId);
      if (!trip) throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
      const snapshot = store.getTripRevision(
        params.tripId,
        params.revisionId,
        principal.userId
      );
      if (!snapshot) {
        throw new ApiError(404, "REVISION_NOT_FOUND", "Trip revision not found.");
      }
      return {
        status: 200,
        body: snapshot,
        headers: { ETag: `"${snapshot.revisionId}"` }
      };
    }
  );

  add("PUT", "/trips/:tripId/schedule", ({
    store,
    params,
    body,
    request,
    principal
  }) => {
    requireObject(body);
    const baseRevisionId = extractBaseRevisionId(request, body);
    const stops = validateStops(body.stops);
    const status = body.status == null
      ? null
      : requireEnum(body.status, "status", ["CONFIRMED"]);
    const plannerState = body.plannerState == null
      ? null
      : validatePlannerState(body.plannerState);
    const trip = store.saveSchedule({
      tripId: params.tripId,
      ownerUserId: principal.userId,
      baseRevisionId,
      stops,
      status,
      plannerState,
      reason: "USER_SCHEDULE_SAVED"
    });
    if (!trip) throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
    return {
      status: 200,
      body: trip,
      headers: { ETag: `"${trip.revisionId}"` }
    };
  });

  add("POST", "/trips/:tripId/agent-runs", ({
    store,
    params,
    body,
    request,
    principal
  }) => {
    requireObject(body);
    const baseRevisionId = extractBaseRevisionId(request, body);
    const instruction = requireString(body.instruction, "instruction", {
      max: 2_000
    });
    const current = store.getTrip(params.tripId, principal.userId);
    if (!current) throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
    if (current.revisionId !== baseRevisionId) throw new RevisionConflictError(current);
    const run = agentManager.startRun({
      tripId: params.tripId,
      ownerUserId: principal.userId,
      baseRevisionId,
      instruction
    });
    return {
      status: 202,
      body: {
        ...run,
        eventCursor: 0
      },
      headers: {
        ETag: `"${run.currentRevisionId}"`,
        Location: `${API_PREFIX}/trips/${params.tripId}/agent-runs/${run.runId}`
      }
    };
  });

  add("GET", "/trips/:tripId/agent-runs", ({ store, params, principal, url }) => {
    const pagination = parsePagination(url);
    const result = store.listAgentRuns(
      params.tripId,
      principal.userId,
      pagination
    );
    if (!result) throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
    return {
      status: 200,
      body: {
        tripId: params.tripId,
        ...result,
        limit: pagination.limit,
        offset: pagination.offset
      }
    };
  });

  add("GET", "/agent-runs/:runId", ({ store, params, principal }) => {
    const run = store.getAgentRun(params.runId, principal.userId);
    if (!run) throw new ApiError(404, "AGENT_RUN_NOT_FOUND", "Agent run not found.");
    return {
      status: 200,
      body: run,
      headers: { ETag: `"${run.currentRevisionId}"` }
    };
  });

  add("GET", "/agent-runs/:runId/events", ({ store, params, principal, url }) => {
    const afterRaw = url.searchParams.get("after") ?? "0";
    if (!/^\d+$/.test(afterRaw) || !Number.isSafeInteger(Number(afterRaw))) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "after must be a non-negative event sequence.",
        [{ field: "after" }]
      );
    }
    const { limit } = parsePagination(url, { defaultLimit: 100, maxLimit: 500 });
    const result = store.listAgentEvents(params.runId, principal.userId, {
      after: Number(afterRaw),
      limit
    });
    if (!result) throw new ApiError(404, "AGENT_RUN_NOT_FOUND", "Agent run not found.");
    return { status: 200, body: { ...result, limit } };
  });

  add("POST", "/agent-runs/:runId/commands", ({
    params,
    body,
    request,
    principal
  }) => {
    requireObject(body);
    const rawCommand = requireString(body.command, "command", { max: 20 }).toLowerCase();
    const command = requireEnum(rawCommand, "command", ["pause", "resume", "stop"]);
    const hasRevision = body.baseRevisionId != null ||
      body.revisionId != null ||
      request.headers["if-match"] != null;
    const baseRevisionId = command === "resume" && hasRevision
      ? extractBaseRevisionId(request, body)
      : null;
    const run = agentManager.command(
      params.runId,
      principal.userId,
      command,
      { baseRevisionId }
    );
    return {
      status: 202,
      body: run,
      headers: { ETag: `"${run.currentRevisionId}"` }
    };
  });

  add("POST", "/agent-runs/:runId/undo", ({ params, body, request, principal }) => {
    requireObject(body);
    const expectedRevisionId = extractBaseRevisionId(request, body);
    const result = agentManager.undo(
      params.runId,
      principal.userId,
      expectedRevisionId
    );
    return {
      status: 200,
      body: {
        run: result.run,
        trip: result.trip
      },
      headers: { ETag: `"${result.trip.revisionId}"` }
    };
  });

  add(
    "GET",
    "/trips/:tripId/agent-runs/:runId",
    ({ store, params, principal }) => {
      const run = store.getAgentRun(params.runId, principal.userId);
      if (!run || run.tripId !== params.tripId) {
        throw new ApiError(404, "AGENT_RUN_NOT_FOUND", "Agent run not found for this trip.");
      }
      return {
        status: 200,
        body: run,
        headers: { ETag: `"${run.currentRevisionId}"` }
      };
    }
  );

  add(
    "GET",
    "/trips/:tripId/agent-runs/:runId/events",
    ({ store, params, principal, url }) => {
      const run = store.getAgentRun(params.runId, principal.userId);
      if (!run || run.tripId !== params.tripId) {
        throw new ApiError(404, "AGENT_RUN_NOT_FOUND", "Agent run not found for this trip.");
      }
      const afterRaw = url.searchParams.get("after") ?? "0";
      if (!/^\d+$/.test(afterRaw) || !Number.isSafeInteger(Number(afterRaw))) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "after must be a non-negative event sequence.",
          [{ field: "after" }]
        );
      }
      const { limit } = parsePagination(url, { defaultLimit: 100, maxLimit: 500 });
      const result = store.listAgentEvents(params.runId, principal.userId, {
        after: Number(afterRaw),
        limit
      });
      return { status: 200, body: { ...result, limit } };
    }
  );

  add(
    "POST",
    "/trips/:tripId/agent-runs/:runId/commands",
    ({ store, params, body, request, principal }) => {
      requireObject(body);
      const existing = store.getAgentRun(params.runId, principal.userId);
      if (!existing || existing.tripId !== params.tripId) {
        throw new ApiError(404, "AGENT_RUN_NOT_FOUND", "Agent run not found for this trip.");
      }
      const rawCommand = requireString(body.command, "command", { max: 20 }).toLowerCase();
      const command = requireEnum(rawCommand, "command", ["pause", "resume", "stop"]);
      const hasRevision = body.baseRevisionId != null ||
        body.revisionId != null ||
        request.headers["if-match"] != null;
      const baseRevisionId = command === "resume" && hasRevision
        ? extractBaseRevisionId(request, body)
        : null;
      const run = agentManager.command(
        params.runId,
        principal.userId,
        command,
        { baseRevisionId }
      );
      return {
        status: 202,
        body: run,
        headers: { ETag: `"${run.currentRevisionId}"` }
      };
    }
  );

  add(
    "POST",
    "/trips/:tripId/agent-runs/:runId/undo",
    ({ store, params, body, request, principal }) => {
      requireObject(body);
      const existing = store.getAgentRun(params.runId, principal.userId);
      if (!existing || existing.tripId !== params.tripId) {
        throw new ApiError(404, "AGENT_RUN_NOT_FOUND", "Agent run not found for this trip.");
      }
      const expectedRevisionId = extractBaseRevisionId(request, body);
      const result = agentManager.undo(
        params.runId,
        principal.userId,
        expectedRevisionId
      );
      return {
        status: 200,
        body: { run: result.run, trip: result.trip },
        headers: { ETag: `"${result.trip.revisionId}"` }
      };
    }
  );

  add("GET", "/trips/:tripId/execution-events", ({
    store,
    params,
    principal,
    url
  }) => {
    const trip = store.getTrip(params.tripId, principal.userId);
    if (!trip) throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
    const pagination = parsePagination(url, { defaultLimit: 100, maxLimit: 500 });
    const items = store.listExecutionEvents(
      params.tripId,
      principal.userId,
      pagination
    );
    const total = store.countExecutionEvents(params.tripId, principal.userId);
    return {
      status: 200,
      body: {
        tripId: params.tripId,
        items,
        total,
        limit: pagination.limit,
        offset: pagination.offset
      }
    };
  });

  add("POST", "/trips/:tripId/execution-events", ({
    store,
    params,
    body,
    principal
  }) => {
    requireObject(body);
    const trip = store.getTrip(params.tripId, principal.userId);
    if (!trip) throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
    const type = requireEnum(body.type, "type", [
      "JOURNEY_STARTED",
      "NAVIGATION_OPENED",
      "STOP_COMPLETED",
      "STOP_SKIPPED",
      "DELAY_RECORDED",
      "STOP_ADDED",
      "JOURNEY_COMPLETED"
    ]);
    const clientStopId = optionalString(body.clientStopId, "clientStopId", { max: 120 });
    if (["STOP_COMPLETED", "STOP_SKIPPED", "NAVIGATION_OPENED"].includes(type)) {
      if (!clientStopId || !trip.stops.some((stop) => stop.clientStopId === clientStopId)) {
        throw new ApiError(400, "VALIDATION_ERROR", "clientStopId must reference a trip stop.", [
          { field: "clientStopId" }
        ]);
      }
    }
    const occurredAt = body.occurredAt
      ? requireTimestamp(body.occurredAt, "occurredAt")
      : new Date();
    const payload = body.payload == null ? {} : requireObject(body.payload, "payload");
    if (
      type === "DELAY_RECORDED" &&
      (!Number.isInteger(payload.delayMinutes) || payload.delayMinutes < 1 || payload.delayMinutes > 1_440)
    ) {
      throw new ApiError(400, "VALIDATION_ERROR", "payload.delayMinutes must be 1..1440.", [
        { field: "payload.delayMinutes" }
      ]);
    }
    const event = store.addExecutionEvent({
      eventId: optionalString(body.eventId, "eventId", { max: 120 }) ?? `event-${randomUUID()}`,
      tripId: params.tripId,
      type,
      clientStopId,
      occurredAt: occurredAt.toISOString(),
      payload,
      recordedAt: new Date().toISOString()
    });
    return { status: 201, body: event };
  });

  add("GET", "/trips/:tripId/booking-options", ({ store, params, principal }) => {
    const trip = store.getTrip(params.tripId, principal.userId);
    if (!trip) throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
    return {
      status: 200,
      body: providerAdapters.meituan.listBookingOptions(trip)
    };
  });

  const createBookingRedirect = ({
    store,
    tripId,
    bookingOptionId,
    ownerUserId
  }) => {
    const trip = store.getTrip(tripId, ownerUserId);
    if (!trip) throw new ApiError(404, "TRIP_NOT_FOUND", "Trip not found.");
    const record = providerAdapters.meituan.createRedirect({ trip, bookingOptionId });
    if (!record) {
      throw new ApiError(404, "BOOKING_OPTION_NOT_FOUND", "Booking option not found.");
    }
    return {
      status: 201,
      body: record
    };
  };

  add(
    "POST",
    "/trips/:tripId/booking-options/:bookingOptionId/redirects",
    ({ store, params, principal }) => createBookingRedirect({
      store,
      tripId: params.tripId,
      bookingOptionId: params.bookingOptionId,
      ownerUserId: principal.userId
    })
  );

  add("POST", "/booking-options/:bookingOptionId/redirects", ({
    store,
    params,
    body,
    principal
  }) => {
    requireObject(body);
    return createBookingRedirect({
      store,
      tripId: requireString(body.tripId, "tripId", { max: 120 }),
      bookingOptionId: params.bookingOptionId,
      ownerUserId: principal.userId
    });
  });

  add("GET", "/providers/baidu/places/search", ({ url }) => {
    const query = requireString(url.searchParams.get("q"), "q", { max: 120 }).toLocaleLowerCase("zh-CN");
    const city = (url.searchParams.get("city") ?? "北京").trim();
    return {
      status: 200,
      body: providerAdapters.baidu.searchPlaces({ q: query, city })
    };
  });

  add("GET", "/providers/baidu/routes", ({ url }) => {
    const originPlaceId = requireString(
      url.searchParams.get("originInternalPlaceId") ??
        url.searchParams.get("originProviderPlaceId") ??
        url.searchParams.get("originPlaceId"),
      "originPlaceId",
      { max: 120 }
    );
    const destinationPlaceId = requireString(
      url.searchParams.get("destinationInternalPlaceId") ??
        url.searchParams.get("destinationProviderPlaceId") ??
        url.searchParams.get("destinationPlaceId"),
      "destinationPlaceId",
      { max: 120 }
    );
    const mode = requireEnum(url.searchParams.get("mode") ?? "walking", "mode", [
      "walking",
      "transit",
      "driving"
    ]);
    const result = providerAdapters.baidu.getRoute({
      originPlaceId,
      destinationPlaceId,
      mode
    });
    if (!result) {
      throw new ApiError(404, "PLACE_NOT_FOUND", "Origin or destination place not found.");
    }
    return {
      status: 200,
      body: result
    };
  });

  return routes;
}

function matchRoute(pathname, pattern) {
  const pathParts = pathname.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(":")) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        throw new ApiError(400, "INVALID_PATH_ENCODING", "URL path encoding is invalid.");
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

async function readJsonBody(request) {
  const declaredLength = request.headers["content-length"];
  if (declaredLength != null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new ApiError(400, "INVALID_CONTENT_LENGTH", "Content-Length is invalid.");
    }
    if (parsedLength > JSON_LIMIT_BYTES) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", `JSON body exceeds ${JSON_LIMIT_BYTES} bytes.`);
    }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT_BYTES) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", `JSON body exceeds ${JSON_LIMIT_BYTES} bytes.`);
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return { raw: "", value: {} };
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json.");
  }
  try {
    return { raw, value: JSON.parse(raw) };
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
}

function createCorsPolicy(request, corsOrigin) {
  const origin = request.headers.origin;
  const allowedOrigins = corsOrigin === "*"
    ? "*"
    : corsOrigin.split(",").map((item) => item.trim()).filter(Boolean);
  const allowed = !origin || allowedOrigins === "*" || allowedOrigins.includes(origin);
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization,Content-Type,Idempotency-Key,If-Match,X-Request-Id,X-User-Id",
    "Access-Control-Expose-Headers": "ETag,Idempotency-Replayed,X-Request-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (allowed && origin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigins === "*" ? "*" : origin;
  } else if (allowed && allowedOrigins === "*") {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return { allowed, headers };
}

function sendJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...headers
  });
  response.end(payload);
}

function errorBody(error, requestId) {
  return {
    error: {
      code: error.code ?? "INTERNAL_ERROR",
      message: error.status ? error.message : "Unexpected server error.",
      ...(error.details ? { details: error.details } : {}),
      requestId
    }
  };
}

export function createApiServer({
  store,
  corsOrigin = "*",
  logger = console,
  authMode = "demo",
  serviceToken = null,
  requireIdempotency = false,
  providerAdapters = null,
  agentManager = null,
  isDraining = () => false,
  shutdownToken = null,
  onShutdown = null
}) {
  if (authMode === "service-token" && !serviceToken) {
    throw new Error("serviceToken is required when authMode is service-token.");
  }
  const providers = providerAdapters ?? createLocalProviderAdapters({ store });
  const agents = agentManager ?? createAgentManager({
    store,
    provider: createUnavailableAgentProvider(),
    logger
  });
  const routes = createRouteTable(providers, {
    isDraining,
    agentManager: agents
  });
  return createServer(async (request, response) => {
    const requestId = normalizeRequestId(request.headers["x-request-id"]);
    const startedAt = process.hrtime.bigint();
    let pathname = "/";
    response.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info?.({
        event: "http_request_complete",
        timestamp: new Date().toISOString(),
        requestId,
        method: request.method,
        pathname,
        status: response.statusCode,
        durationMs: Number(durationMs.toFixed(2))
      });
    });

    try {
      const url = new URL(request.url, "http://127.0.0.1");
      pathname = url.pathname;
      const cors = createCorsPolicy(request, corsOrigin);
      const baseHeaders = {
        ...cors.headers,
        "X-Request-Id": requestId,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      };
      if (!cors.allowed) {
        throw new ApiError(
          403,
          "CORS_ORIGIN_DENIED",
          "This browser Origin is not allowed to access the API."
        );
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204, baseHeaders);
        response.end();
        return;
      }

      if (url.pathname === "/internal/shutdown") {
        const remoteAddress = request.socket.remoteAddress ?? "";
        const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
        const suppliedToken = request.headers["x-shutdown-token"];
        if (
          request.method !== "POST" ||
          !shutdownToken ||
          !loopback.has(remoteAddress) ||
          typeof suppliedToken !== "string" ||
          !equalSecret(suppliedToken, shutdownToken)
        ) {
          throw new ApiError(404, "NOT_FOUND", "Endpoint not found.");
        }
        sendJson(response, 202, { status: "shutdown_requested", requestId }, baseHeaders);
        setImmediate(() => onShutdown?.("LOCAL_CONTROL"));
        return;
      }

      if (
        url.pathname !== API_PREFIX &&
        !url.pathname.startsWith(`${API_PREFIX}/`)
      ) {
        throw new ApiError(404, "NOT_FOUND", `API routes start with ${API_PREFIX}.`);
      }
      const relativePath = url.pathname.slice(API_PREFIX.length) || "/";
      const pathCandidates = routes.filter(
        (candidate) => matchRoute(relativePath, candidate.pattern)
      );
      const route = pathCandidates.find((candidate) => candidate.method === request.method);
      if (!route && pathCandidates.length > 0) {
        const allowedMethods = [...new Set(pathCandidates.map((candidate) => candidate.method))];
        const methodError = new ApiError(
          405,
          "METHOD_NOT_ALLOWED",
          "The endpoint does not support this HTTP method."
        );
        methodError.responseHeaders = { Allow: allowedMethods.join(", ") };
        throw methodError;
      }
      if (!route) throw new ApiError(404, "NOT_FOUND", "Endpoint not found.");
      const params = matchRoute(relativePath, route.pattern);
      const principal = PUBLIC_PATHS.has(relativePath)
        ? { userId: "public", authMode: "public" }
        : resolvePrincipal(request, { authMode, serviceToken });
      const bodyResult = MUTATING_METHODS.has(request.method)
        ? await readJsonBody(request)
        : { raw: "", value: {} };
      const idempotencyKey = request.headers["idempotency-key"];
      if (requireIdempotency && MUTATING_METHODS.has(request.method) && !idempotencyKey) {
        throw new ApiError(
          428,
          "IDEMPOTENCY_KEY_REQUIRED",
          "Idempotency-Key is required for mutating requests."
        );
      }

      let idempotencyInput = null;
      if (idempotencyKey && MUTATING_METHODS.has(request.method)) {
        requireString(idempotencyKey, "Idempotency-Key", { max: 200 });
        const requestHash = createHash("sha256")
          .update(
            `${request.method}\n${relativePath}\n${request.headers["if-match"] ?? ""}\n${bodyResult.raw}`
          )
          .digest("hex");
        idempotencyInput = {
          ownerUserId: principal.userId,
          method: request.method,
          routePattern: route.pattern,
          key: idempotencyKey,
          requestHash
        };
      }

      if (route.prepare && idempotencyInput) {
        const replay = store.getIdempotencyRecord(
          idempotencyInput.ownerUserId,
          idempotencyInput.method,
          idempotencyInput.routePattern,
          idempotencyInput.key
        );
        if (replay) {
          if (replay.requestHash !== idempotencyInput.requestHash) {
            throw new IdempotencyConflictError();
          }
          sendJson(response, replay.statusCode, replay.response, {
            ...baseHeaders,
            ...replay.headers,
            "Idempotency-Replayed": "true"
          });
          return;
        }
      }

      const prepared = route.prepare
        ? await route.prepare({
            store,
            request,
            url,
            params,
            body: bodyResult.value,
            requestId,
            principal
          })
        : null;

      const executeHandler = () => route.handler({
        store,
        request,
        url,
        params,
        body: bodyResult.value,
        requestId,
        principal,
        prepared
      });

      if (idempotencyInput) {
        const execution = store.executeIdempotently(idempotencyInput, executeHandler);
        if (execution.replayed) {
          sendJson(response, execution.result.statusCode, execution.result.response, {
            ...baseHeaders,
            ...execution.result.headers,
            "Idempotency-Replayed": "true"
          });
          return;
        }
        sendJson(response, execution.result.status, execution.result.body, {
          ...baseHeaders,
          ...execution.result.headers
        });
        return;
      }

      const result = await executeHandler();
      sendJson(response, result.status, result.body, { ...baseHeaders, ...result.headers });
    } catch (error) {
      const cors = createCorsPolicy(request, corsOrigin);
      const baseHeaders = {
        ...cors.headers,
        "X-Request-Id": requestId,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      };
      if (error instanceof RevisionConflictError) {
        const conflict = new ApiError(
          409,
          "REVISION_CONFLICT",
          "Trip revision is stale. Refresh and retry against the current revision.",
          [{
            currentRevisionId: error.currentTrip.revisionId,
            currentRevision: error.currentTrip.revision
          }]
        );
        sendJson(response, conflict.status, errorBody(conflict, requestId), baseHeaders);
        return;
      }
      if (error instanceof TripStatusConflictError) {
        const conflict = new ApiError(
          409,
          "INVALID_TRIP_STATUS_TRANSITION",
          "Only DRAFT to CONFIRMED, or CONFIRMED to CONFIRMED, is allowed here.",
          [{
            currentStatus: error.currentTrip.status,
            requestedStatus: error.requestedStatus
          }]
        );
        sendJson(response, conflict.status, errorBody(conflict, requestId), baseHeaders);
        return;
      }
      if (error instanceof AgentRunError) {
        const agentError = new ApiError(
          error.status,
          error.code,
          error.message,
          error.details
        );
        sendJson(response, agentError.status, errorBody(agentError, requestId), baseHeaders);
        return;
      }
      if (error instanceof IdempotencyConflictError) {
        const conflict = new ApiError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "The Idempotency-Key was already used with a different request."
        );
        sendJson(response, conflict.status, errorBody(conflict, requestId), baseHeaders);
        return;
      }
      if (error?.code === "SQLITE_CONSTRAINT_PRIMARYKEY" || error?.code === "SQLITE_CONSTRAINT_UNIQUE") {
        const conflict = new ApiError(409, "DUPLICATE_RESOURCE", "A resource with this id already exists.");
        sendJson(response, conflict.status, errorBody(conflict, requestId), baseHeaders);
        return;
      }
      if (error?.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        const invalidReference = new ApiError(
          409,
          "INVALID_RESOURCE_REFERENCE",
          "A referenced resource no longer exists."
        );
        sendJson(
          response,
          invalidReference.status,
          errorBody(invalidReference, requestId),
          baseHeaders
        );
        return;
      }
      if (error?.code === "SQLITE_CONSTRAINT_CHECK") {
        const constraint = new ApiError(
          400,
          "DATABASE_CONSTRAINT_VIOLATION",
          "The request violates a persisted data constraint."
        );
        sendJson(response, constraint.status, errorBody(constraint, requestId), baseHeaders);
        return;
      }
      if (error?.code === "SQLITE_BUSY") {
        const busy = new ApiError(
          503,
          "DATABASE_BUSY",
          "The database is temporarily busy. Retry the request."
        );
        sendJson(response, busy.status, errorBody(busy, requestId), {
          ...baseHeaders,
          "Retry-After": "1"
        });
        return;
      }
      const apiError = error instanceof ApiError
        ? error
        : new ApiError(500, "INTERNAL_ERROR", "Unexpected server error.");
      if (!(error instanceof ApiError)) logger.error?.({ requestId, error });
      const responseHeaders = {
        ...baseHeaders,
        ...(apiError.responseHeaders ?? {}),
        ...(apiError.status === 401 ? { "WWW-Authenticate": "Bearer" } : {})
      };
      sendJson(response, apiError.status, errorBody(apiError, requestId), responseHeaders);
    }
  });
}
