const FALLBACK_IMAGES = [
  "/assets/beijing-hero-hutong.png",
  "/assets/beijing-wudaoying.png",
  "/assets/beijing-guozijian.png",
  "/assets/beijing-guardian-art.png",
  "/assets/beijing-jingshan.png",
  "/assets/beijing-shichahai.png",
];

const FALLBACK_POSITIONS = [
  { left: "20%", top: "30%" },
  { left: "34%", top: "62%" },
  { left: "46%", top: "78%" },
  { left: "61%", top: "42%" },
  { left: "76%", top: "22%" },
  { left: "84%", top: "54%" },
];

const XIAOHONGSHU_HOSTS = new Set([
  "xiaohongshu.com",
  "www.xiaohongshu.com",
  "xhslink.com",
  "www.xhslink.com",
]);

const SUPPORTED_COORD_SYSTEMS = new Set([
  "WGS84",
  "GCJ02",
  "BD09",
  "BD09LL",
  "BD09_MOCK",
]);

export class TravelDataError extends Error {
  constructor(message, { code = "INVALID_TRAVEL_DATA", details = null } = {}) {
    super(message);
    this.name = "TravelDataError";
    this.code = code;
    this.details = details;
  }
}

function firstDefined(...values) {
  return values.find((value) => (
    value !== undefined
    && value !== null
    && (typeof value !== "string" || value.trim() !== "")
  ));
}

function unwrapPayload(payload) {
  return payload?.data ?? payload?.result ?? payload ?? {};
}

function compactText(value, fallback = "") {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text || fallback;
}

function toDurationMinutes(value, fallback = 75) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(15, Math.min(720, numeric));
}

function toCoordinate(value, { min, max }) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= min && numeric <= max
    ? numeric
    : null;
}

function coordinatesFrom(value) {
  const latitude = toCoordinate(
    firstDefined(value?.latitude, value?.lat, value?.location?.latitude, value?.location?.lat),
    { min: -90, max: 90 },
  );
  const longitude = toCoordinate(
    firstDefined(value?.longitude, value?.lng, value?.location?.longitude, value?.location?.lng),
    { min: -180, max: 180 },
  );
  if (latitude === null || longitude === null) {
    return { latitude: null, longitude: null, coordSystem: null };
  }

  const requestedSystem = compactText(
    firstDefined(value?.coordSystem, value?.location?.coordSystem),
  );
  return {
    latitude,
    longitude,
    coordSystem: SUPPORTED_COORD_SYSTEMS.has(requestedSystem)
      ? requestedSystem
      : "BD09_MOCK",
  };
}

function hasVerifiedBaiduCoordinates(value) {
  const system = compactText(
    firstDefined(value?.coordSystem, value?.location?.coordSystem),
  ).toUpperCase();
  return system === "BD09" || system === "BD09LL";
}

export function normalizeScheduledTime(value, index = 0) {
  const match = String(value ?? "").match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/u);
  if (match) {
    const hours = Math.min(23, Number.parseInt(match[1], 10));
    const minutes = Math.min(59, Number.parseInt(match[2], 10));
    const snapped = Math.min(
      23 * 60 + 45,
      Math.round((hours * 60 + minutes) / 15) * 15,
    );
    return `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`;
  }

  const fallback = Math.min(23 * 60 + 45, 9 * 60 + Math.max(0, index) * 90);
  return `${String(Math.floor(fallback / 60)).padStart(2, "0")}:${String(fallback % 60).padStart(2, "0")}`;
}

function timeToMinutes(time) {
  const [hours, minutes] = normalizeScheduledTime(time).split(":").map(Number);
  return hours * 60 + minutes;
}

export function extractShareUrl(value) {
  const source = String(value ?? "")
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  const matches = source.match(/https?:\/\/[^\s<>"'，。；、]+/giu) ?? [];

  for (const match of matches) {
    const candidate = match.replace(/[，。；、！？,.!;；）)\]}]+$/gu, "");
    try {
      const parsed = new URL(candidate);
      const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
      if (
        !XIAOHONGSHU_HOSTS.has(hostname)
        || parsed.username
        || parsed.password
        || parsed.port
      ) {
        continue;
      }
      parsed.protocol = "https:";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      // A share message can contain multiple links; keep looking for an official one.
    }
  }

  return "";
}

export function normalizeXiaohongshuImport(payload, requestedShareUrl = "") {
  const raw = unwrapPayload(payload);
  const rawExtraction = raw.extraction ?? raw.routeDraft ?? raw.route ?? raw.extracted ?? {};
  const rawSource = raw.source ?? raw.attribution ?? {};
  const rawStops = firstDefined(
    rawExtraction.stops,
    rawExtraction.places,
    raw.stops,
    raw.places,
    [],
  );
  const sourceUrl = firstDefined(
    rawSource.sourceUrl,
    rawSource.url,
    raw.sourceUrl,
    raw.shareUrl,
    requestedShareUrl,
  );
  const authorName = compactText(
    firstDefined(
      rawSource.authorName,
      rawSource.creatorName,
      rawSource.author?.displayName,
      rawExtraction.authorName,
    ),
    "小红书路线创作者",
  );

  const normalizedStops = (Array.isArray(rawStops) ? rawStops : []).map((stop, index) => {
    const coordinates = coordinatesFrom(stop);
    const durationMinutes = toDurationMinutes(
      firstDefined(stop.durationMinutes, stop.duration, stop.visitDurationMinutes),
    );
    const name = compactText(
      firstDefined(stop.name, stop.placeName, stop.title),
      `提取地点 ${index + 1}`,
    );
    const providerRefs = Array.isArray(stop.providerRefs)
      ? stop.providerRefs
          .filter((reference) => reference?.provider && reference?.providerPlaceId)
          .map((reference) => ({
            provider: String(reference.provider),
            providerPlaceId: String(reference.providerPlaceId),
          }))
      : stop.providerPlaceId
        ? [{ provider: "baidu", providerPlaceId: String(stop.providerPlaceId) }]
        : [];
    const id = firstDefined(stop.clientStopId, stop.id, index + 1);

    return {
      id,
      clientStopId: String(id),
      sourceStopId: String(
        firstDefined(stop.sourceStopId, stop.id, stop.placeId, `source-stop-${index + 1}`),
      ),
      placeId: firstDefined(stop.internalPlaceId, stop.placeId) ?? null,
      providerRefs,
      name,
      address: compactText(firstDefined(stop.address, stop.formattedAddress)),
      ...coordinates,
      time: normalizeScheduledTime(
        firstDefined(stop.suggestedTime, stop.time, stop.arrivalTime),
        index,
      ),
      durationMinutes,
      duration: `${durationMinutes} 分钟`,
      type: compactText(firstDefined(stop.category, stop.type), "笔记提取地点"),
      image: firstDefined(
        stop.imageUrl,
        stop.image,
        stop.coverImageUrl,
        FALLBACK_IMAGES[index % FALLBACK_IMAGES.length],
      ),
      note: compactText(
        firstDefined(stop.note, stop.description, stop.caption),
        "来自用户主动交接的小红书分享链接，地点信息请在规划画布中确认。",
      ),
      travel: compactText(
        firstDefined(stop.travel, stop.transfer),
        index === 0 ? "路线起点" : "交通时间待地图核验",
      ),
      cost: compactText(firstDefined(stop.cost, stop.costRange), "消费信息待核验"),
      locked: Boolean(stop.locked),
      libraryTitle: compactText(firstDefined(stop.storyTitle, stop.title), name),
      libraryCreator: authorName,
      libraryAvatar: firstDefined(
        rawSource.avatarUrl,
        rawSource.author?.avatarUrl,
        "/assets/creator-chen.png",
      ),
      libraryTag: compactText(firstDefined(stop.tag, stop.category), "小红书灵感"),
      libraryTone: "local",
      position: stop.position ?? FALLBACK_POSITIONS[index % FALLBACK_POSITIONS.length],
    };
  });

  if (!normalizedStops.length) {
    throw new TravelDataError("接口返回成功，但没有可加入画布的地点。", {
      code: "EMPTY_EXTRACTION",
      details: payload,
    });
  }

  const title = compactText(
    firstDefined(rawExtraction.title, rawExtraction.noteTitle, raw.title),
    "从小红书笔记整理的北京路线",
  );
  const city = compactText(firstDefined(rawExtraction.city, raw.city), "北京");

  return {
    importId: String(firstDefined(raw.importId, raw.id, `local-import-${Date.now()}`)),
    status: compactText(firstDefined(raw.status), "READY_FOR_REVIEW"),
    source: {
      platform: compactText(firstDefined(rawSource.platform), "XIAOHONGSHU"),
      sourceUrl,
      resolvedUrl: firstDefined(rawSource.resolvedUrl, sourceUrl),
      providerContentId: firstDefined(rawSource.providerContentId) ?? null,
      label: compactText(firstDefined(rawSource.label), "小红书笔记"),
      authorName,
      collaborationMode: compactText(
        firstDefined(rawSource.collaborationMode),
        "USER_INITIATED_MOCK_NO_PARTNERSHIP",
      ),
      metadataStatus: compactText(firstDefined(rawSource.metadataStatus), "FALLBACK"),
      fallbackCode: firstDefined(rawSource.fallbackCode) ?? null,
      capturedAt: firstDefined(rawSource.capturedAt, raw.createdAt, new Date().toISOString()),
    },
    extraction: {
      mode: compactText(firstDefined(rawExtraction.mode), "DEMO_ROUTE_FALLBACK"),
      title,
      city,
      summary: compactText(
        firstDefined(rawExtraction.summary, rawExtraction.description),
        `已整理 ${normalizedStops.length} 个可编辑地点。`,
      ),
      coverImageUrl: firstDefined(
        rawExtraction.coverImageUrl,
        rawExtraction.cover,
        normalizedStops[0]?.image,
      ),
      stops: normalizedStops,
    },
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
  };
}

function findCatalogPlace(catalog, stop) {
  const identifiers = [
    stop.id,
    stop.clientStopId,
    stop.sourceStopId,
    stop.placeId,
  ].filter((value) => value !== null && value !== undefined).map(String);
  return catalog.find((place) => (
    identifiers.includes(String(place.id))
    || identifiers.includes(String(place.clientStopId))
    || identifiers.includes(String(place.sourceStopId))
    || identifiers.includes(String(place.placeId))
    || compactText(place.name) === compactText(stop.name)
  )) ?? null;
}

export function buildPlannerStateFromImport(importRecord, availablePlaces = []) {
  const normalized = importRecord?.extraction?.stops?.[0]?.clientStopId
    ? importRecord
    : normalizeXiaohongshuImport(importRecord, importRecord?.source?.sourceUrl);
  const catalog = Array.isArray(availablePlaces) ? availablePlaces : [];
  const places = [];
  const unmatchedStops = [];

  normalized.extraction.stops.forEach((stop, index) => {
    const existing = findCatalogPlace(catalog, stop);
    const id = existing?.id ?? stop.id ?? `import-stop-${index + 1}`;
    if (!existing) unmatchedStops.push(stop);
    places.push({
      ...existing,
      ...stop,
      id,
      time: stop.time,
      duration: `${stop.durationMinutes} 分钟`,
    });
  });

  return {
    places,
    timelineSlots: places
      .map((place, index) => ({
        slotId: `import-${normalized.importId}-${index + 1}`,
        stopId: place.id,
        time: normalizeScheduledTime(place.time, index),
      }))
      .sort((left, right) => timeToMinutes(left.time) - timeToMinutes(right.time)),
    selectedRoute: {
      id: `xiaohongshu:${normalized.importId}`,
      title: normalized.extraction.title,
      city: normalized.extraction.city,
      days: `1 天 · ${places.length} 站`,
      tag: "小红书灵感",
      creator: normalized.source.authorName,
      image: normalized.extraction.coverImageUrl,
      summary: normalized.extraction.summary,
      highlights: places.slice(0, 4).map((place) => place.name),
      sourceImportId: normalized.importId,
    },
    unmatchedStops,
  };
}

export function buildTripStops({ scheduleItems, places }) {
  if (!Array.isArray(scheduleItems) || scheduleItems.length === 0) {
    throw new TravelDataError("至少安排一个地点后才能保存行程。", {
      code: "EMPTY_SCHEDULE",
    });
  }
  const catalog = Array.isArray(places) ? places : [];

  return scheduleItems
    .map((schedule, index) => {
      const place = catalog.find((item) => String(item.id) === String(schedule.stopId));
      if (!place) {
        throw new TravelDataError(`找不到排程地点：${schedule.stopId}`, {
          code: "UNKNOWN_SCHEDULE_STOP",
          details: { stopId: schedule.stopId },
        });
      }
      const coordinates = coordinatesFrom(place);
      return {
        clientStopId: String(schedule.stopId),
        sourceStopId: firstDefined(
          place.sourceStopId,
          place.routeStopId,
        ) ?? null,
        placeId: firstDefined(place.internalPlaceId, place.placeId) ?? null,
        providerRefs: Array.isArray(place.providerRefs)
          ? place.providerRefs
              .filter((reference) => reference?.provider && reference?.providerPlaceId)
              .map((reference) => ({
                provider: String(reference.provider),
                providerPlaceId: String(reference.providerPlaceId),
              }))
          : [],
        name: compactText(place.name, `地点 ${index + 1}`),
        scheduledTime: normalizeScheduledTime(schedule.time, index),
        durationMinutes: toDurationMinutes(
          firstDefined(place.durationMinutes, place.duration),
        ),
        note: compactText(place.note),
        address: compactText(place.address),
        ...coordinates,
        imageUrl: firstDefined(place.imageUrl, place.image) ?? null,
        category: firstDefined(place.category, place.type) ?? null,
        locked: Boolean(place.locked),
      };
    })
    .sort((left, right) => timeToMinutes(left.scheduledTime) - timeToMinutes(right.scheduledTime));
}

export function buildConfirmedTripPayload({
  scheduleItems,
  places,
  sourceImport = null,
  title,
  city,
  route = null,
  status = "CONFIRMED",
  plannerState = null,
}) {
  const source = sourceImport
    ? {
        platform: "XIAOHONGSHU",
        handoffMode: "USER_INITIATED",
        collaborationMode: sourceImport.source?.collaborationMode,
        providerContentId: sourceImport.source?.providerContentId,
        label: sourceImport.source?.label,
        authorName: sourceImport.source?.authorName,
        capturedAt: sourceImport.source?.capturedAt,
      }
    : {
        platform: "ROUTE_STORY",
        handoffMode: "IN_APP_TEMPLATE",
        providerContentId: route?.id,
        label: route?.title,
        authorName: typeof route?.creator === "string"
          ? route.creator
          : route?.creator?.name,
      };
  const explicitSourceRouteId = firstDefined(
    route?.backendRouteId,
    route?.sourceRouteId,
  ) ?? null;

  return {
    title: compactText(
      firstDefined(title, sourceImport?.extraction?.title, route?.title),
      "我的北京旅行路线",
    ),
    city: compactText(
      firstDefined(city, sourceImport?.extraction?.city, route?.city),
      "北京",
    ).split("·")[0],
    timezone: "Asia/Shanghai",
    status,
    sourceImportId: sourceImport?.importId ?? null,
    sourceRouteId: explicitSourceRouteId,
    sourceUrl: sourceImport?.source?.sourceUrl ?? null,
    source,
    stops: buildTripStops({ scheduleItems, places }),
    plannerState: {
      constraints: Array.isArray(plannerState?.constraints)
        ? plannerState.constraints.map((constraint) => ({ ...constraint }))
        : [],
      transportModeOverrides: (
        plannerState?.transportModeOverrides
        && typeof plannerState.transportModeOverrides === "object"
        && !Array.isArray(plannerState.transportModeOverrides)
      )
        ? { ...plannerState.transportModeOverrides }
        : {},
    },
  };
}

export function normalizeTripReceipt(payload, fallbackTripId = null) {
  const raw = unwrapPayload(payload);
  return {
    tripId: firstDefined(raw.tripId, raw.id, fallbackTripId) ?? null,
    revisionId: firstDefined(raw.revisionId, raw.currentRevisionId, raw.versionId) ?? null,
    revision: Number.isInteger(raw.revision) ? raw.revision : null,
    status: compactText(firstDefined(raw.status), "CONFIRMED"),
    savedAt: firstDefined(raw.savedAt, raw.createdAt, new Date().toISOString()),
    raw,
  };
}

export function mergeTripReceiptWithSubmittedSnapshot(receipt, submittedTrip = {}) {
  const normalizedReceipt = receipt?.raw
    ? receipt
    : normalizeTripReceipt(receipt, submittedTrip?.tripId);
  const rawReceipt = (
    normalizedReceipt?.raw
    && typeof normalizedReceipt.raw === "object"
    && !Array.isArray(normalizedReceipt.raw)
  )
    ? normalizedReceipt.raw
    : {};
  const submitted = (
    submittedTrip
    && typeof submittedTrip === "object"
    && !Array.isArray(submittedTrip)
  )
    ? submittedTrip
    : {};
  const submittedPlannerState = (
    submitted.plannerState
    && typeof submitted.plannerState === "object"
    && !Array.isArray(submitted.plannerState)
  )
    ? submitted.plannerState
    : {};
  const receiptPlannerState = (
    rawReceipt.plannerState
    && typeof rawReceipt.plannerState === "object"
    && !Array.isArray(rawReceipt.plannerState)
  )
    ? rawReceipt.plannerState
    : null;
  const plannerState = receiptPlannerState ?? submittedPlannerState;
  const stops = Array.isArray(rawReceipt.stops)
    ? rawReceipt.stops
    : Array.isArray(submitted.stops)
      ? submitted.stops
      : [];

  return {
    ...submitted,
    ...rawReceipt,
    tripId: firstDefined(
      normalizedReceipt?.tripId,
      rawReceipt.tripId,
      rawReceipt.id,
      submitted.tripId,
    ) ?? null,
    revisionId: firstDefined(
      normalizedReceipt?.revisionId,
      rawReceipt.revisionId,
      rawReceipt.currentRevisionId,
      submitted.revisionId,
    ) ?? null,
    revision: Number.isInteger(normalizedReceipt?.revision)
      ? normalizedReceipt.revision
      : Number.isInteger(rawReceipt.revision)
        ? rawReceipt.revision
        : null,
    status: compactText(
      firstDefined(rawReceipt.status, submitted.status, normalizedReceipt?.status),
      "DRAFT",
    ),
    savedAt: firstDefined(
      normalizedReceipt?.savedAt,
      rawReceipt.savedAt,
      rawReceipt.createdAt,
      submitted.savedAt,
      new Date().toISOString(),
    ),
    stops: stops.map((stop) => ({ ...stop })),
    plannerState: {
      constraints: Array.isArray(plannerState.constraints)
        ? plannerState.constraints.map((constraint) => ({ ...constraint }))
        : [],
      transportModeOverrides: (
        plannerState.transportModeOverrides
        && typeof plannerState.transportModeOverrides === "object"
        && !Array.isArray(plannerState.transportModeOverrides)
      )
        ? { ...plannerState.transportModeOverrides }
        : {},
    },
  };
}

export function buildPlannerStateFromTrip(payload, availablePlaces = []) {
  const raw = unwrapPayload(payload);
  const rawStops = Array.isArray(raw.stops) ? raw.stops : [];
  const rawPlannerState = (
    raw.plannerState
    && typeof raw.plannerState === "object"
    && !Array.isArray(raw.plannerState)
  )
    ? raw.plannerState
    : {};
  const catalog = Array.isArray(availablePlaces) ? availablePlaces : [];
  const places = rawStops.map((stop, index) => {
    const existing = findCatalogPlace(catalog, {
      ...stop,
      id: stop.clientStopId,
    });
    const persistedCoordinates = coordinatesFrom(stop);
    const catalogCoordinates = coordinatesFrom(existing);
    const coordinates = (
      persistedCoordinates.coordSystem === "BD09_MOCK"
      && hasVerifiedBaiduCoordinates(existing)
    )
      ? catalogCoordinates
      : persistedCoordinates.latitude !== null
        ? persistedCoordinates
        : catalogCoordinates;
    const id = existing?.id ?? stop.clientStopId ?? `trip-stop-${index + 1}`;
    const durationMinutes = toDurationMinutes(stop.durationMinutes);
    return {
      ...existing,
      id,
      clientStopId: String(stop.clientStopId ?? id),
      sourceStopId: stop.sourceStopId ?? existing?.sourceStopId ?? null,
      internalPlaceId: stop.placeId ?? existing?.internalPlaceId ?? null,
      providerRefs: Array.isArray(stop.providerRefs) ? stop.providerRefs : [],
      name: compactText(stop.name, existing?.name ?? `地点 ${index + 1}`),
      address: compactText(stop.address, existing?.address ?? ""),
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      coordSystem: coordinates.coordSystem,
      time: normalizeScheduledTime(stop.scheduledTime, index),
      durationMinutes,
      duration: `${durationMinutes} 分钟`,
      note: compactText(stop.note, existing?.note ?? ""),
      image: firstDefined(stop.imageUrl, existing?.image, existing?.imageUrl, FALLBACK_IMAGES[index % FALLBACK_IMAGES.length]),
      type: firstDefined(stop.category, existing?.type, existing?.category, "旅行地点"),
      locked: Boolean(stop.locked),
    };
  });

  return {
    trip: normalizeTripReceipt(raw),
    places,
    plannerState: {
      constraints: Array.isArray(rawPlannerState.constraints)
        ? rawPlannerState.constraints.map((constraint) => ({ ...constraint }))
        : [],
      transportModeOverrides: (
        rawPlannerState.transportModeOverrides
        && typeof rawPlannerState.transportModeOverrides === "object"
        && !Array.isArray(rawPlannerState.transportModeOverrides)
      )
        ? { ...rawPlannerState.transportModeOverrides }
        : {},
    },
    timelineSlots: places
      .map((place, index) => ({
        slotId: `trip-stop-${String(place.clientStopId ?? place.id ?? index + 1)}`,
        stopId: place.id,
        time: place.time,
      }))
      .sort((left, right) => timeToMinutes(left.time) - timeToMinutes(right.time)),
  };
}

export function normalizeBookingOptions(payload) {
  const raw = unwrapPayload(payload);
  const options = (Array.isArray(raw.options) ? raw.options : []).map((option) => ({
    ...option,
    bookingOptionId: String(option.bookingOptionId),
    clientStopId: String(option.clientStopId),
    placeName: compactText(option.placeName, option.location?.name ?? "当前地点"),
    address: compactText(option.address, option.location?.address ?? "地址待确认"),
    productType: option.productType === "DINING" ? "DINING" : "ACTIVITY",
    availabilityStatus: compactText(option.availabilityStatus, "SIMULATED"),
    disclosure: compactText(
      option.disclosure,
      "当前为合作接入演示，不代表实时库存或已产生订单。",
    ),
  }));

  return {
    tripId: firstDefined(raw.tripId) ?? null,
    provider: raw.provider ?? {
      id: "meituan",
      mode: "MOCK_NO_PARTNERSHIP",
      connected: false,
    },
    options,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
    byClientStopId: Object.groupBy
      ? Object.groupBy(options, (option) => option.clientStopId)
      : options.reduce((groups, option) => {
          (groups[option.clientStopId] ??= []).push(option);
          return groups;
        }, {}),
  };
}
