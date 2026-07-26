import {
  extractShareUrl,
  normalizeBookingOptions,
  normalizeTripReceipt,
  normalizeXiaohongshuImport,
} from "./travelMappers.js";

export const DEFAULT_API_ORIGIN =
  typeof __TRAVEL_API_DEFAULT_ORIGIN__ === "string"
    ? __TRAVEL_API_DEFAULT_ORIGIN__
    : "";
export const DEMO_USER_ID = "demo-user";

function readViteEnvironment(name) {
  try {
    return import.meta.env?.[name];
  } catch {
    return undefined;
  }
}

export function normalizeApiBaseUrl(value = DEFAULT_API_ORIGIN) {
  const candidate = String(value ?? "").trim() || DEFAULT_API_ORIGIN;
  const withoutTrailingSlash = candidate.replace(/\/+$/u, "");
  return /\/api\/v1$/u.test(withoutTrailingSlash)
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/api/v1`;
}

export function manualScheduleStatus(currentStatus) {
  return currentStatus === "CONFIRMED" ? "CONFIRMED" : undefined;
}

const configuredApiBaseUrl =
  typeof __TRAVEL_API_ALLOW_ENV_OVERRIDE__ !== "undefined"
  && __TRAVEL_API_ALLOW_ENV_OVERRIDE__
    ? readViteEnvironment("VITE_API_BASE_URL")
    : undefined;
export const API_BASE_URL = normalizeApiBaseUrl(configuredApiBaseUrl);

export class ApiRequestError extends Error {
  constructor(message, {
    status = 0,
    code = "API_REQUEST_FAILED",
    details = null,
    requestId = null,
    retryable = false,
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

function randomIdentifier(prefix) {
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

export function createIdempotencyKey(scope = "write") {
  const safeScope = String(scope).replace(/[^A-Za-z0-9._:-]/gu, "-").slice(0, 60) || "write";
  return randomIdentifier(`route-story-${safeScope}`).slice(0, 200);
}

function createRequestId() {
  return randomIdentifier("web");
}

function isMutatingMethod(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

function encodePathSegment(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new ApiRequestError(`${fieldName} 不能为空。`, {
      code: "INVALID_REQUEST_ARGUMENT",
      details: { field: fieldName },
    });
  }
  return encodeURIComponent(normalized);
}

function buildPaginationQuery({ limit = 20, offset = 0, ...rest } = {}) {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  Object.entries(rest).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  });
  return query;
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json") || /^[\s]*[\[{]/u.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }
  return { message: text };
}

function errorMessageFromPayload(payload, status) {
  return payload?.error?.message
    || payload?.message
    || `请求失败（HTTP ${status}）。`;
}

function createAttemptSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(externalSignal?.reason);

  if (externalSignal?.aborted) {
    forwardAbort();
  } else {
    externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  }
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("API request timed out"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup() {
      globalThis.clearTimeout(timer);
      externalSignal?.removeEventListener("abort", forwardAbort);
    },
  };
}

function asRequestBody(body) {
  if (body === undefined) return undefined;
  return typeof body === "string" ? body : JSON.stringify(body);
}

export function createTravelApi({
  baseUrl = API_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  retryCount = 1,
  defaultHeaders = {},
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("createTravelApi requires a fetch implementation.");
  }

  const resolvedBaseUrl = normalizeApiBaseUrl(baseUrl);

  async function request(path, {
    method = "GET",
    headers = {},
    body,
    signal,
    idempotencyKey,
  } = {}) {
    const normalizedMethod = String(method).toUpperCase();
    const requestBody = asRequestBody(body);
    const writeRequest = isMutatingMethod(normalizedMethod);
    const stableIdempotencyKey = writeRequest
      ? idempotencyKey || createIdempotencyKey(normalizedMethod.toLowerCase())
      : null;
    const requestHeaders = {
      Accept: "application/json",
      "X-Request-Id": createRequestId(),
      ...defaultHeaders,
      ...headers,
    };
    if (requestBody !== undefined) requestHeaders["Content-Type"] = "application/json";
    if (stableIdempotencyKey) requestHeaders["Idempotency-Key"] = stableIdempotencyKey;

    const retryableRequest = ["GET", "HEAD"].includes(normalizedMethod)
      || Boolean(stableIdempotencyKey);
    const attempts = retryableRequest ? Math.max(1, retryCount + 1) : 1;
    let response;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const attemptSignal = createAttemptSignal(signal, timeoutMs);
      try {
        response = await fetchImpl(`${resolvedBaseUrl}${path}`, {
          method: normalizedMethod,
          headers: requestHeaders,
          body: requestBody,
          signal: attemptSignal.signal,
        });
        attemptSignal.cleanup();
        break;
      } catch (error) {
        const didTimeOut = attemptSignal.didTimeOut();
        attemptSignal.cleanup();
        if (signal?.aborted) {
          throw new ApiRequestError("请求已取消。", {
            code: "API_REQUEST_ABORTED",
            details: error,
            retryable: false,
            cause: error,
          });
        }
        if (attempt + 1 < attempts) continue;
        throw new ApiRequestError(
          didTimeOut
            ? `后端响应超时（${resolvedBaseUrl}）。`
            : `无法连接行程服务（${resolvedBaseUrl}）。请稍后重试。`,
          {
            code: didTimeOut ? "API_TIMEOUT" : "API_UNREACHABLE",
            details: error,
            retryable: true,
            cause: error,
          },
        );
      }
    }

    const payload = await parseResponseBody(response);
    if (!response.ok) {
      const errorPayload = payload?.error ?? {};
      const requestId = errorPayload.requestId
        ?? response.headers.get("x-request-id")
        ?? null;
      throw new ApiRequestError(errorMessageFromPayload(payload, response.status), {
        status: response.status,
        code: errorPayload.code ?? payload?.code ?? "API_REQUEST_FAILED",
        details: errorPayload.details ?? payload,
        requestId,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      });
    }

    return payload;
  }

  async function importXiaohongshuShare(value, { idempotencyKey, signal } = {}) {
    const shareText = String(value ?? "").trim().slice(0, 12_000);
    const shareUrl = extractShareUrl(shareText);
    if (!shareUrl) {
      throw new ApiRequestError("请粘贴有效的小红书官方分享链接。", {
        code: "INVALID_SHARE_URL",
      });
    }
    const payload = await request("/imports/xiaohongshu", {
      method: "POST",
      idempotencyKey,
      signal,
      body: {
        shareUrl,
        shareText,
        handoffMode: "USER_INITIATED",
      },
    });
    return normalizeXiaohongshuImport(payload, shareUrl);
  }

  async function createTrip(trip, { idempotencyKey, signal } = {}) {
    const payload = await request("/trips", {
      method: "POST",
      idempotencyKey,
      signal,
      body: trip,
    });
    return normalizeTripReceipt(payload);
  }

  async function saveTripSchedule({
    tripId,
    revisionId,
    stops,
    plannerState,
    status,
    idempotencyKey,
    signal,
  }) {
    const encodedTripId = encodePathSegment(tripId, "tripId");
    const normalizedRevisionId = String(revisionId ?? "").trim();
    if (!normalizedRevisionId) {
      throw new ApiRequestError("保存排程需要当前 revisionId。", {
        code: "MISSING_REVISION_ID",
      });
    }
    const payload = await request(`/trips/${encodedTripId}/schedule`, {
      method: "PUT",
      idempotencyKey,
      signal,
      headers: {
        "If-Match": `"${normalizedRevisionId}"`,
      },
      body: {
        baseRevisionId: normalizedRevisionId,
        stops,
        ...(plannerState ? { plannerState } : {}),
        ...(status ? { status } : {}),
      },
    });
    return normalizeTripReceipt(payload, tripId);
  }

  async function recordExecutionEvent(tripId, event, { idempotencyKey, signal } = {}) {
    const eventId = event?.eventId ?? randomIdentifier("client-event");
    return request(
      `/trips/${encodePathSegment(tripId, "tripId")}/execution-events`,
      {
        method: "POST",
        idempotencyKey,
        signal,
        body: {
          ...event,
          eventId,
        },
      },
    );
  }

  async function createBookingRedirect(
    tripId,
    bookingOptionId,
    { idempotencyKey, signal } = {},
  ) {
    return request(
      `/trips/${encodePathSegment(tripId, "tripId")}/booking-options/${encodePathSegment(bookingOptionId, "bookingOptionId")}/redirects`,
      {
        method: "POST",
        idempotencyKey,
        signal,
        body: {},
      },
    );
  }

  return Object.freeze({
    baseUrl: resolvedBaseUrl,
    request,
    health: () => request("/health"),
    listImports: (options = {}) => request(
      `/imports?${buildPaginationQuery(options).toString()}`,
    ),
    getImport: (importId) => request(
      `/imports/${encodePathSegment(importId, "importId")}`,
    ),
    importXiaohongshuShare,
    createTrip,
    createConfirmedTrip: createTrip,
    listTrips: ({ status, limit = 20, offset = 0 } = {}) => request(
      `/trips?${buildPaginationQuery({ status, limit, offset }).toString()}`,
    ),
    getTrip: (tripId) => request(
      `/trips/${encodePathSegment(tripId, "tripId")}`,
    ),
    saveTripSchedule,
    listTripRevisions: (tripId, { limit = 20, offset = 0 } = {}) => request(
      `/trips/${encodePathSegment(tripId, "tripId")}/revisions?${buildPaginationQuery({ limit, offset }).toString()}`,
    ),
    getTripRevision: (tripId, revisionId) => request(
      `/trips/${encodePathSegment(tripId, "tripId")}/revisions/${encodePathSegment(revisionId, "revisionId")}`,
    ),
    listAgentRuns: (tripId, { limit = 20, offset = 0 } = {}) => request(
      `/trips/${encodePathSegment(tripId, "tripId")}/agent-runs?${buildPaginationQuery({ limit, offset }).toString()}`,
    ),
    createAgentRun: (tripId, input, { idempotencyKey, signal } = {}) => request(
      `/trips/${encodePathSegment(tripId, "tripId")}/agent-runs`,
      {
        method: "POST",
        idempotencyKey,
        signal,
        body: typeof input === "string" ? { instruction: input } : input,
      },
    ),
    listBookingOptions: async (tripId) => normalizeBookingOptions(
      await request(`/trips/${encodePathSegment(tripId, "tripId")}/booking-options`),
    ),
    getBookingOptions: async (tripId) => normalizeBookingOptions(
      await request(`/trips/${encodePathSegment(tripId, "tripId")}/booking-options`),
    ),
    createBookingRedirect,
    recordExecutionEvent,
    listExecutionEvents: (tripId, { limit = 100, offset = 0 } = {}) => request(
      `/trips/${encodePathSegment(tripId, "tripId")}/execution-events?${buildPaginationQuery({ limit, offset }).toString()}`,
    ),
    searchBaiduPlaces: ({ q, query, city = "北京" }) => {
      const searchTerm = String(q ?? query ?? "").trim();
      if (!searchTerm) {
        throw new ApiRequestError("百度地点搜索词不能为空。", {
          code: "INVALID_REQUEST_ARGUMENT",
          details: { field: "q" },
        });
      }
      const parameters = new URLSearchParams({ q: searchTerm, city });
      return request(`/providers/baidu/places/search?${parameters.toString()}`);
    },
    getBaiduRoute: ({
      originPlaceId,
      destinationPlaceId,
      mode = "walking",
    }) => {
      const parameters = new URLSearchParams({
        originPlaceId: String(originPlaceId ?? ""),
        destinationPlaceId: String(destinationPlaceId ?? ""),
        mode,
      });
      if (!originPlaceId || !destinationPlaceId) {
        throw new ApiRequestError("路线计算需要起点和终点地点 ID。", {
          code: "INVALID_REQUEST_ARGUMENT",
          details: { fields: ["originPlaceId", "destinationPlaceId"] },
        });
      }
      return request(`/providers/baidu/routes?${parameters.toString()}`);
    },
  });
}

export const travelApi = createTravelApi();

export const healthCheck = (...args) => travelApi.health(...args);
export const listImports = (...args) => travelApi.listImports(...args);
export const getImport = (...args) => travelApi.getImport(...args);
export const importXiaohongshuShare = (...args) => travelApi.importXiaohongshuShare(...args);
export const createConfirmedTrip = (...args) => travelApi.createConfirmedTrip(...args);
export const createTrip = (...args) => travelApi.createTrip(...args);
export const listTrips = (...args) => travelApi.listTrips(...args);
export const getTrip = (...args) => travelApi.getTrip(...args);
export const saveTripSchedule = (...args) => travelApi.saveTripSchedule(...args);
export const listTripRevisions = (...args) => travelApi.listTripRevisions(...args);
export const getTripRevision = (...args) => travelApi.getTripRevision(...args);
export const listBookingOptions = (...args) => travelApi.listBookingOptions(...args);
export const getBookingOptions = (...args) => travelApi.getBookingOptions(...args);
export const createBookingRedirect = (...args) => travelApi.createBookingRedirect(...args);
export const recordExecutionEvent = (...args) => travelApi.recordExecutionEvent(...args);
export const listExecutionEvents = (...args) => travelApi.listExecutionEvents(...args);
export const searchBaiduPlaces = (...args) => travelApi.searchBaiduPlaces(...args);
export const getBaiduRoute = (...args) => travelApi.getBaiduRoute(...args);

export {
  buildConfirmedTripPayload,
  buildPlannerStateFromImport,
  buildPlannerStateFromTrip,
  buildTripStops,
  extractShareUrl,
  normalizeBookingOptions,
  normalizeScheduledTime,
  normalizeTripReceipt,
  normalizeXiaohongshuImport,
  mergeTripReceiptWithSubmittedSnapshot,
  TravelDataError,
} from "./travelMappers.js";
