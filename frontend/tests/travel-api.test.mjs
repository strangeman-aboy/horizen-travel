import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiRequestError,
  buildConfirmedTripPayload,
  buildPlannerStateFromImport,
  buildPlannerStateFromTrip,
  createTravelApi,
  extractShareUrl,
  manualScheduleStatus,
  mergeTripReceiptWithSubmittedSnapshot,
  normalizeApiBaseUrl,
  normalizeBookingOptions,
  normalizeScheduledTime,
  normalizeXiaohongshuImport,
} from "../src/api/travelApi.js";

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

test("API base URL accepts either an origin or the complete v1 prefix", () => {
  assert.equal(
    normalizeApiBaseUrl("http://127.0.0.1:8787"),
    "http://127.0.0.1:8787/api/v1",
  );
  assert.equal(
    normalizeApiBaseUrl("http://127.0.0.1:8787/api/v1/"),
    "http://127.0.0.1:8787/api/v1",
  );
  assert.equal(normalizeApiBaseUrl("/backend"), "/backend/api/v1");
});

test("Xiaohongshu share extraction accepts only exact official hosts", () => {
  assert.equal(
    extractShareUrl("复制这段内容 https://xhslink.com/aBc123?share=1，打开小红书"),
    "https://xhslink.com/aBc123?share=1",
  );
  assert.equal(
    extractShareUrl("http://www.xiaohongshu.com/explore/abc123#comments"),
    "https://www.xiaohongshu.com/explore/abc123",
  );
  assert.equal(extractShareUrl("https://xhslink.com.evil.example/note"), "");
  assert.equal(extractShareUrl("https://xhslink.com:8443/note"), "");
});

test("scheduled times are snapped to valid 15-minute values", () => {
  assert.equal(normalizeScheduledTime("09:08"), "09:15");
  assert.equal(normalizeScheduledTime("23:59"), "23:45");
  assert.equal(normalizeScheduledTime(null, 2), "12:00");
});

test("Xiaohongshu DTO normalization preserves provenance and editable Beijing stops", () => {
  const normalized = normalizeXiaohongshuImport({
    importId: "import-1",
    status: "READY_FOR_REVIEW",
    source: {
      platform: "XIAOHONGSHU",
      sourceUrl: "https://xhslink.com/note-1",
      metadataStatus: "PUBLIC_METADATA",
      authorName: "公开分享页",
    },
    extraction: {
      mode: "PUBLIC_METADATA_WITH_DEMO_ROUTE",
      title: "胡同散步",
      city: "北京",
      stops: [
        {
          id: "route-stop-lama-temple",
          placeId: "place-lama-temple",
          name: "雍和宫",
          suggestedTime: "09:08",
          durationMinutes: 75,
          lat: 39.9475,
          lng: 116.4173,
          coordSystem: "BD09_MOCK",
        },
        {
          id: "route-stop-wudaoying",
          name: "五道营胡同",
          suggestedTime: "10:30",
          durationMinutes: 90,
        },
      ],
    },
    warnings: ["地点仍使用北京演示模板。"],
  });

  assert.equal(normalized.importId, "import-1");
  assert.equal(normalized.source.authorName, "公开分享页");
  assert.equal(normalized.extraction.stops[0].time, "09:15");
  assert.equal(normalized.extraction.stops[0].latitude, 39.9475);
  assert.equal(normalized.extraction.stops[0].coordSystem, "BD09_MOCK");
  assert.equal(normalized.extraction.stops[1].duration, "90 分钟");
  assert.deepEqual(normalized.warnings, ["地点仍使用北京演示模板。"]);
});

test("imported demo stops map back to the existing visual place identifiers", () => {
  const imported = normalizeXiaohongshuImport({
    importId: "import-2",
    source: { sourceUrl: "https://xhslink.com/note-2" },
    extraction: {
      title: "北京一日",
      city: "北京",
      stops: [
        { id: "external-1", name: "雍和宫", suggestedTime: "09:00", durationMinutes: 75 },
        { id: "external-2", name: "五道营胡同", suggestedTime: "10:30", durationMinutes: 90 },
      ],
    },
  });
  const planner = buildPlannerStateFromImport(imported, [
    { id: 1, name: "雍和宫", image: "/lama.png" },
    { id: 2, name: "五道营胡同", image: "/hutong.png" },
  ]);

  assert.deepEqual(planner.timelineSlots.map((slot) => slot.stopId), [1, 2]);
  assert.equal(planner.places[0].id, 1);
  assert.equal(planner.selectedRoute.sourceImportId, "import-2");
  assert.equal(planner.unmatchedStops.length, 0);
});

test("confirmed-trip mapper produces the persisted contract and chronological stops", () => {
  const payload = buildConfirmedTripPayload({
    title: "胡同与艺文",
    city: "北京·东城",
    route: {
      id: "beijing-hutong-art",
      title: "北京胡同与艺文一日",
      creator: "陈以欢",
    },
    scheduleItems: [
      { slotId: "slot-2", stopId: 2, time: "10:30" },
      { slotId: "slot-1", stopId: 1, time: "09:00" },
    ],
    places: [
      {
        id: 1,
        name: "雍和宫",
        duration: "75 分钟",
        type: "古建与祈福",
        image: "/lama.png",
      },
      {
        id: 2,
        name: "五道营胡同",
        durationMinutes: 90,
        type: "咖啡与早午餐",
        image: "/hutong.png",
      },
    ],
    plannerState: {
      constraints: [{ id: "saturday-morning", label: "Saturday morning unavailable" }],
      transportModeOverrides: { "slot-1>slot-2": "TRANSIT" },
    },
  });

  assert.equal(payload.city, "北京");
  assert.equal(payload.status, "CONFIRMED");
  assert.equal(payload.source.platform, "ROUTE_STORY");
  assert.equal(payload.sourceRouteId, null);
  assert.deepEqual(payload.stops.map((stop) => stop.clientStopId), ["1", "2"]);
  assert.deepEqual(payload.stops.map((stop) => stop.scheduledTime), ["09:00", "10:30"]);
  assert.equal(payload.stops[0].durationMinutes, 75);
  assert.equal(payload.stops[0].latitude, null);
  assert.equal(payload.stops[0].coordSystem, null);
  assert.deepEqual(payload.plannerState, {
    constraints: [{ id: "saturday-morning", label: "Saturday morning unavailable" }],
    transportModeOverrides: { "slot-1>slot-2": "TRANSIT" },
  });
});

test("trip receipt merges with the submitted snapshot without a blocking trip reload", () => {
  const submittedTrip = {
    title: "北京胡同与艺文一日",
    city: "北京",
    status: "CONFIRMED",
    source: {
      platform: "ROUTE_STORY",
      providerContentId: "beijing-hutong-art",
    },
    stops: [
      {
        clientStopId: "1",
        name: "雍和宫",
        scheduledTime: "09:00",
        durationMinutes: 75,
      },
      {
        clientStopId: "2",
        name: "五道营胡同",
        scheduledTime: "10:30",
        durationMinutes: 90,
      },
    ],
    plannerState: {
      constraints: [{ id: "morning-only", label: "上午出发" }],
      transportModeOverrides: { "1>2": "WALKING" },
    },
  };
  const canonical = mergeTripReceiptWithSubmittedSnapshot({
    tripId: "trip-1",
    revisionId: "revision-1",
    revision: 1,
    status: "CONFIRMED",
    savedAt: "2026-07-25T12:00:00.000Z",
    raw: {
      tripId: "trip-1",
      revisionId: "revision-1",
      revision: 1,
      status: "CONFIRMED",
      savedAt: "2026-07-25T12:00:00.000Z",
    },
  }, submittedTrip);

  assert.equal(canonical.tripId, "trip-1");
  assert.equal(canonical.revisionId, "revision-1");
  assert.equal(canonical.revision, 1);
  assert.equal(canonical.title, submittedTrip.title);
  assert.deepEqual(canonical.stops, submittedTrip.stops);
  assert.notEqual(canonical.stops, submittedTrip.stops);
  assert.deepEqual(canonical.plannerState, submittedTrip.plannerState);

  const restored = buildPlannerStateFromTrip(canonical, [
    { id: 1, name: "雍和宫" },
    { id: 2, name: "五道营胡同" },
  ]);
  assert.deepEqual(restored.timelineSlots.map((slot) => slot.stopId), [1, 2]);
  assert.equal(restored.trip.revisionId, "revision-1");
});

test("trip receipt prefers canonical server stops when they are returned", () => {
  const canonical = mergeTripReceiptWithSubmittedSnapshot({
    tripId: "trip-2",
    revisionId: "revision-3",
    revision: 3,
    status: "CONFIRMED",
    raw: {
      tripId: "trip-2",
      revisionId: "revision-3",
      revision: 3,
      status: "CONFIRMED",
      stops: [{ clientStopId: "server-stop", scheduledTime: "09:15" }],
    },
  }, {
    status: "DRAFT",
    stops: [{ clientStopId: "submitted-stop", scheduledTime: "09:00" }],
    plannerState: {},
  });

  assert.equal(canonical.status, "CONFIRMED");
  assert.deepEqual(canonical.stops, [
    { clientStopId: "server-stop", scheduledTime: "09:15" },
  ]);
});

test("trip restore keeps stable slot ids and replaces legacy mock coordinates with verified Baidu coordinates", () => {
  const restored = buildPlannerStateFromTrip({
    tripId: "trip-1",
    revisionId: "revision-9",
    revision: 9,
    status: "DRAFT",
    plannerState: {
      constraints: [{ id: "saturday-morning" }],
      transportModeOverrides: { "trip-stop-1>trip-stop-2": "WALK" },
    },
    stops: [{
      clientStopId: "1",
      name: "Lama Temple",
      scheduledTime: "14:30",
      durationMinutes: 75,
      latitude: 39.9475,
      longitude: 116.4173,
      coordSystem: "BD09_MOCK",
    }],
  }, [{
    id: 1,
    clientStopId: "1",
    name: "Lama Temple",
    latitude: 39.953377859,
    longitude: 116.42370918,
    coordSystem: "BD09LL",
  }]);

  assert.equal(restored.timelineSlots[0].slotId, "trip-stop-1");
  assert.equal(restored.timelineSlots[0].time, "14:30");
  assert.equal(restored.places[0].latitude, 39.953377859);
  assert.equal(restored.places[0].longitude, 116.42370918);
  assert.equal(restored.places[0].coordSystem, "BD09LL");
  assert.deepEqual(restored.plannerState.constraints, [{ id: "saturday-morning" }]);
  assert.deepEqual(
    restored.plannerState.transportModeOverrides,
    { "trip-stop-1>trip-stop-2": "WALK" },
  );
});

test("write retry reuses one idempotency key and normalizes the trip receipt", async () => {
  const attempts = [];
  const api = createTravelApi({
    baseUrl: "http://127.0.0.1:8787",
    fetchImpl: async (url, options) => {
      attempts.push({ url, options });
      if (attempts.length === 1) throw new TypeError("temporary network failure");
      return jsonResponse({
        tripId: "trip-1",
        revisionId: "revision-1",
        revision: 1,
        status: "CONFIRMED",
        savedAt: "2026-07-25T00:00:00.000Z",
      }, { status: 201 });
    },
    timeoutMs: 1_000,
    retryCount: 1,
  });

  const receipt = await api.createTrip({ title: "北京路线", stops: [] });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].url, "http://127.0.0.1:8787/api/v1/trips");
  assert.equal(
    attempts[0].options.headers["Idempotency-Key"],
    attempts[1].options.headers["Idempotency-Key"],
  );
  assert.match(attempts[0].options.headers["Idempotency-Key"], /^route-story-post-/u);
  assert.equal(receipt.tripId, "trip-1");
  assert.equal(receipt.revisionId, "revision-1");
  assert.equal(receipt.revision, 1);
});

test("schedule saves include a quoted If-Match revision and surface conflict details", async () => {
  let captured;
  const api = createTravelApi({
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return jsonResponse({
        error: {
          code: "REVISION_CONFLICT",
          message: "Trip revision is stale.",
          requestId: "request-409",
          details: [{ currentRevisionId: "revision-2", currentRevision: 2 }],
        },
      }, {
        status: 409,
        headers: { "x-request-id": "request-409" },
      });
    },
    retryCount: 0,
  });

  await assert.rejects(
    api.saveTripSchedule({
      tripId: "trip 1",
      revisionId: "revision-1",
      stops: [{ clientStopId: "1" }],
      plannerState: {
        constraints: [{ id: "saturday-morning" }],
        transportModeOverrides: {},
      },
      status: "CONFIRMED",
    }),
    (error) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "REVISION_CONFLICT");
      assert.equal(error.requestId, "request-409");
      assert.deepEqual(error.details, [{ currentRevisionId: "revision-2", currentRevision: 2 }]);
      return true;
    },
  );

  assert.match(captured.url, /\/trips\/trip%201\/schedule$/u);
  assert.equal(captured.options.headers["If-Match"], "\"revision-1\"");
  assert.deepEqual(JSON.parse(captured.options.body), {
    baseRevisionId: "revision-1",
    stops: [{ clientStopId: "1" }],
    plannerState: {
      constraints: [{ id: "saturday-morning" }],
      transportModeOverrides: {},
    },
    status: "CONFIRMED",
  });
});

test("manual schedule saves preserve DRAFT implicitly and send only CONFIRMED explicitly", async () => {
  const capturedBodies = [];
  const api = createTravelApi({
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      capturedBodies.push(body);
      return jsonResponse({
        tripId: "trip-1",
        revisionId: `revision-${capturedBodies.length + 1}`,
        revision: capturedBodies.length + 1,
        status: body.status ?? "DRAFT",
      });
    },
    retryCount: 0,
  });
  const schedule = {
    tripId: "trip-1",
    revisionId: "revision-1",
    stops: [{ clientStopId: "1", scheduledTime: "09:15" }],
    plannerState: { constraints: [], transportModeOverrides: {} },
  };

  await api.saveTripSchedule({
    ...schedule,
    status: manualScheduleStatus("DRAFT"),
  });
  await api.saveTripSchedule({
    ...schedule,
    status: manualScheduleStatus("CONFIRMED"),
  });

  assert.equal(Object.hasOwn(capturedBodies[0], "status"), false);
  assert.equal(capturedBodies[1].status, "CONFIRMED");
});

test("provider calls encode queries and keep Meituan mock disclosure grouped by stop", async () => {
  const requests = [];
  const api = createTravelApi({
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.includes("places/search")) {
        return jsonResponse({ items: [{ name: "雍和宫" }] });
      }
      return jsonResponse({
        tripId: "trip-1",
        provider: { id: "meituan", connected: false },
        options: [{
          bookingOptionId: "mock:1",
          clientStopId: "1",
          placeName: "雍和宫",
          address: "北京市东城区雍和宫大街12号",
          productType: "ACTIVITY",
          availabilityStatus: "SIMULATED",
          disclosure: "未查询实时库存。",
        }],
        warnings: ["演示数据"],
      });
    },
    retryCount: 0,
  });

  await api.searchBaiduPlaces({ q: "雍和宫 门票", city: "北京" });
  const booking = await api.listBookingOptions("trip-1");

  assert.match(requests[0], /q=%E9%9B%8D%E5%92%8C%E5%AE%AB\+%E9%97%A8%E7%A5%A8/u);
  assert.equal(booking.options[0].availabilityStatus, "SIMULATED");
  assert.equal(booking.byClientStopId["1"][0].bookingOptionId, "mock:1");
  assert.deepEqual(booking.warnings, ["演示数据"]);
});

test("standalone booking normalization tolerates a minimal provider payload", () => {
  const normalized = normalizeBookingOptions({
    tripId: "trip-2",
    options: [{
      bookingOptionId: "option-1",
      clientStopId: 7,
      placeName: "故宫博物院",
      productType: "ACTIVITY",
    }],
  });
  assert.equal(normalized.options[0].clientStopId, "7");
  assert.match(normalized.options[0].disclosure, /演示/u);
});
