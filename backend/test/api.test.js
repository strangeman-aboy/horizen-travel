import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { createAgentManager } from "../src/agent-manager.js";
import { createScriptedAgentProvider } from "../src/agent-provider.js";
import { createApiServer } from "../src/app.js";
import { migrateAgentOperationsToProviderLineage } from "../src/migrations.js";
import { createLocalProviderAdapters } from "../src/providers.js";
import { createStore } from "../src/store.js";

function jsonHeaders(idempotencyKey) {
  return {
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}/api/v1`;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function api(baseUrl, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

test("Hackathon API persists and protects the complete demo flow", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-api-"));
  const databasePath = join(temporaryDirectory, "api.sqlite");
  let store = createStore({ filePath: databasePath });
  const fakeAgentProvider = createScriptedAgentProvider({
    script: [
      {
        toolName: "move_stop",
        arguments: {
          client_stop_id: "route-stop-lama-temple",
          new_scheduled_time: "08:30",
          reason: "为后续安排留出时间"
        }
      },
      {
        toolName: "finish_replan",
        arguments: { summary: "已完成受约束的测试调整" }
      }
    ]
  });
  const agentManager = createAgentManager({
    store,
    provider: fakeAgentProvider,
    logger: { error() {} }
  });
  let server = createApiServer({
    store,
    agentManager,
    logger: { error() {} }
  });
  let baseUrl = await listen(server);
  let tripId;
  let latestRevisionId;

  try {
    const health = await api(baseUrl, "/health", {
      headers: { Origin: "http://127.0.0.1:5173" }
    });
    assert.equal(health.response.status, 200);
    assert.equal(health.body.status, "ok");
    assert.equal(health.body.persistence, "sqlite");
    assert.equal(health.body.providers.baidu, "LOCAL_PROVIDER_MOCK_NO_PARTNERSHIP");
    assert.equal(health.response.headers.get("access-control-allow-origin"), "*");

    const preflight = await api(baseUrl, "/trips", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:5173",
        "Access-Control-Request-Method": "POST"
      }
    });
    assert.equal(preflight.response.status, 204);
    assert.match(preflight.response.headers.get("access-control-allow-headers"), /Idempotency-Key/);

    const routes = await api(baseUrl, "/routes?city=%E5%8C%97%E4%BA%AC");
    assert.equal(routes.response.status, 200);
    assert.equal(routes.body.total, 1);
    assert.equal(routes.body.items[0].stops.length, 6);
    assert.equal(routes.body.items[0].stops[0].place.name, "雍和宫");

    const importRequest = {
      method: "POST",
      headers: jsonHeaders("import-demo-1"),
      body: JSON.stringify({
        shareUrl: "https://www.xiaohongshu.com/explore/hackathon-demo",
        handoffMode: "USER_INITIATED"
      })
    };
    const imported = await api(baseUrl, "/imports/xiaohongshu", importRequest);
    assert.equal(imported.response.status, 201);
    assert.equal(imported.body.status, "READY_FOR_REVIEW");
    assert.equal(imported.body.source.collaborationMode, "USER_INITIATED_MOCK_NO_PARTNERSHIP");
    assert.equal(imported.body.source.metadataStatus, "FALLBACK");
    assert.equal(imported.body.source.fallbackCode, "PREVIEW_DISABLED");
    assert.equal(imported.body.extraction.mode, "DEMO_ROUTE_FALLBACK");
    assert.equal(imported.body.extraction.stops.length, 6);
    assert.equal(imported.body.extraction.stops[0].address, "北京市东城区雍和宫大街12号");
    assert.equal(imported.body.extraction.stops[0].lat, 39.953377859);
    assert.equal(imported.body.extraction.stops[0].lng, 116.42370918);
    assert.equal(imported.body.extraction.stops[0].coordSystem, "BD09LL");
    assert.ok(imported.body.warnings.some((warning) => warning.includes("没有调用小红书接口")));

    const replayedImport = await api(baseUrl, "/imports/xiaohongshu", importRequest);
    assert.equal(replayedImport.response.status, 201);
    assert.equal(replayedImport.response.headers.get("idempotency-replayed"), "true");
    assert.equal(replayedImport.body.importId, imported.body.importId);

    const reusedKey = await api(baseUrl, "/imports/xiaohongshu", {
      method: "POST",
      headers: jsonHeaders("import-demo-1"),
      body: JSON.stringify({
        shareUrl: "https://www.xiaohongshu.com/explore/a-different-demo",
        handoffMode: "USER_INITIATED"
      })
    });
    assert.equal(reusedKey.response.status, 409);
    assert.equal(reusedKey.body.error.code, "IDEMPOTENCY_KEY_REUSED");

    const tripCreated = await api(baseUrl, "/trips", {
      method: "POST",
      headers: jsonHeaders("create-trip-1"),
      body: JSON.stringify({
        title: imported.body.extraction.title,
        city: imported.body.extraction.city,
        timezone: "Asia/Shanghai",
        status: "CONFIRMED",
        sourceImportId: imported.body.importId,
        sourceUrl: imported.body.source.sourceUrl,
        source: {
          platform: "XIAOHONGSHU",
          handoffMode: "USER_INITIATED",
          collaborationMode: imported.body.source.collaborationMode,
          authorName: imported.body.source.authorName
        }
      })
    });
    assert.equal(tripCreated.response.status, 201);
    assert.equal(tripCreated.body.revision, 1);
    tripId = tripCreated.body.tripId;
    latestRevisionId = tripCreated.body.revisionId;

    const loadedTrip = await api(baseUrl, `/trips/${tripId}`);
    assert.equal(loadedTrip.response.status, 200);
    assert.equal(loadedTrip.body.stops.length, 6);
    assert.equal(loadedTrip.body.stops[0].address, imported.body.extraction.stops[0].address);
    assert.equal(loadedTrip.body.stops[0].latitude, imported.body.extraction.stops[0].lat);
    assert.equal(loadedTrip.body.stops[0].longitude, imported.body.extraction.stops[0].lng);
    assert.equal(loadedTrip.body.stops[0].coordSystem, "BD09LL");
    assert.equal(loadedTrip.body.source.platform, "XIAOHONGSHU");
    assert.equal(loadedTrip.body.source.authorName, imported.body.source.authorName);
    assert.equal(loadedTrip.body.stops[0].sourceStopId, imported.body.extraction.stops[0].id);
    assert.deepEqual(loadedTrip.body.stops[0].providerRefs, []);
    assert.equal(loadedTrip.response.headers.get("etag"), `"${latestRevisionId}"`);

    const scheduleStopsWithCoordinateAliases = loadedTrip.body.stops.map(
      ({ latitude, longitude, ...stop }) => ({
        ...stop,
        lat: latitude,
        lng: longitude
      })
    );
    const scheduleRequest = {
      method: "PUT",
      headers: jsonHeaders("schedule-save-1"),
      body: JSON.stringify({
        baseRevisionId: latestRevisionId,
        stops: scheduleStopsWithCoordinateAliases
      })
    };
    const scheduleSaved = await api(baseUrl, `/trips/${tripId}/schedule`, scheduleRequest);
    assert.equal(scheduleSaved.response.status, 200);
    assert.equal(scheduleSaved.body.revision, 2);
    assert.notEqual(scheduleSaved.body.revisionId, latestRevisionId);
    assert.equal(scheduleSaved.body.stops[0].latitude, imported.body.extraction.stops[0].lat);
    assert.equal(scheduleSaved.body.stops[0].longitude, imported.body.extraction.stops[0].lng);
    const replayedSchedule = await api(
      baseUrl,
      `/trips/${tripId}/schedule`,
      scheduleRequest
    );
    assert.equal(replayedSchedule.response.status, 200);
    assert.equal(replayedSchedule.response.headers.get("idempotency-replayed"), "true");
    assert.equal(
      replayedSchedule.response.headers.get("etag"),
      scheduleSaved.response.headers.get("etag")
    );
    assert.equal(replayedSchedule.body.revisionId, scheduleSaved.body.revisionId);

    const staleSave = await api(baseUrl, `/trips/${tripId}/schedule`, {
      method: "PUT",
      headers: jsonHeaders("schedule-save-stale"),
      body: JSON.stringify({
        baseRevisionId: latestRevisionId,
        stops: loadedTrip.body.stops
      })
    });
    assert.equal(staleSave.response.status, 409);
    assert.equal(staleSave.body.error.code, "REVISION_CONFLICT");
    latestRevisionId = scheduleSaved.body.revisionId;

    const agentRun = await api(baseUrl, `/trips/${tripId}/agent-runs`, {
      method: "POST",
      headers: jsonHeaders("agent-run-1"),
      body: JSON.stringify({
        baseRevisionId: latestRevisionId,
        instruction: "请把第一站稍微提前，并保持其他安排"
      })
    });
    assert.equal(agentRun.response.status, 202);
    assert.equal(agentRun.body.status, "QUEUED");
    await agentManager.waitForIdle(agentRun.body.runId);
    const completedRun = await api(baseUrl, `/agent-runs/${agentRun.body.runId}`);
    assert.equal(completedRun.response.status, 200);
    assert.equal(completedRun.body.status, "COMPLETED");
    const agentTrip = await api(baseUrl, `/trips/${tripId}`);
    assert.equal(agentTrip.body.stops[0].scheduledTime, "08:30");
    const agentLamaTemple = agentTrip.body.stops.find(
      (stop) => stop.clientStopId === imported.body.extraction.stops[0].id
    );
    assert.equal(agentLamaTemple.address, imported.body.extraction.stops[0].address);
    assert.equal(agentLamaTemple.latitude, imported.body.extraction.stops[0].lat);
    assert.equal(agentLamaTemple.longitude, imported.body.extraction.stops[0].lng);
    assert.equal(agentLamaTemple.coordSystem, "BD09LL");
    assert.deepEqual(
      completedRun.body.operations.map((operation) => operation.toolName),
      ["move_stop", "finish_replan"]
    );
    latestRevisionId = completedRun.body.resultRevisionId;

    const listedTrips = await api(baseUrl, "/trips?limit=10&offset=0");
    assert.equal(listedTrips.response.status, 200);
    assert.ok(listedTrips.body.items.some((item) => item.tripId === tripId));
    assert.equal(
      listedTrips.body.items.find((item) => item.tripId === tripId).source.platform,
      "XIAOHONGSHU"
    );

    const revisions = await api(baseUrl, `/trips/${tripId}/revisions`);
    assert.equal(revisions.response.status, 200);
    assert.equal(revisions.body.total, 3);
    assert.equal(revisions.body.items[0].revisionId, latestRevisionId);
    const historical = await api(
      baseUrl,
      `/trips/${tripId}/revisions/${scheduleSaved.body.revisionId}`
    );
    assert.equal(historical.response.status, 200);
    assert.equal(historical.body.revision, 2);
    assert.equal(historical.body.isCurrentRevision, false);

    const agentRuns = await api(baseUrl, `/trips/${tripId}/agent-runs`);
    assert.equal(agentRuns.response.status, 200);
    assert.equal(agentRuns.body.total, 1);
    assert.equal(agentRuns.body.items[0].runId, agentRun.body.runId);

    const execution = await api(baseUrl, `/trips/${tripId}/execution-events`, {
      method: "POST",
      headers: jsonHeaders("execution-event-1"),
      body: JSON.stringify({
        eventId: "client-event-stop-1",
        type: "STOP_COMPLETED",
        clientStopId: agentTrip.body.stops[0].clientStopId,
        occurredAt: "2026-07-25T04:00:00.000Z",
        payload: { actualDurationMinutes: 82 }
      })
    });
    assert.equal(execution.response.status, 201);
    assert.equal(execution.body.type, "STOP_COMPLETED");

    const bookingOptions = await api(baseUrl, `/trips/${tripId}/booking-options`);
    assert.equal(bookingOptions.response.status, 200);
    assert.equal(bookingOptions.body.provider.connected, false);
    assert.equal(bookingOptions.body.options.length, 6);
    assert.match(bookingOptions.body.options[0].disclosure, /未查询美团|演示合作接入位/);
    const lamaTempleOption = bookingOptions.body.options.find(
      (option) => option.clientStopId === imported.body.extraction.stops[0].id
    );
    assert.equal(lamaTempleOption.address, "北京市东城区雍和宫大街12号");
    assert.equal(lamaTempleOption.availabilityStatus, "SIMULATED");

    const firstOption = lamaTempleOption;
    const redirect = await api(
      baseUrl,
      `/trips/${tripId}/booking-options/${encodeURIComponent(firstOption.bookingOptionId)}/redirects`,
      {
        method: "POST",
        headers: jsonHeaders("booking-redirect-1"),
        body: "{}"
      }
    );
    assert.equal(redirect.response.status, 201);
    assert.equal(redirect.body.status, "MOCK_PLACEHOLDER");
    assert.equal(redirect.body.receiptStatus, "MOCK_RECORDED");
    assert.equal(redirect.body.option.address, "北京市东城区雍和宫大街12号");
    assert.equal(redirect.body.redirectUrl, null);

    const baiduSearch = await api(
      baseUrl,
      "/providers/baidu/places/search?q=%E9%9B%8D%E5%92%8C%E5%AE%AB&city=%E5%8C%97%E4%BA%AC"
    );
    assert.equal(baiduSearch.response.status, 200);
    assert.equal(baiduSearch.body.provider.connected, false);
    assert.equal(baiduSearch.body.items[0].internalPlaceId, "place-lama-temple");

    const baiduRoute = await api(
      baseUrl,
      "/providers/baidu/routes?originPlaceId=place-lama-temple&destinationPlaceId=place-wudaoying&mode=walking"
    );
    assert.equal(baiduRoute.response.status, 200);
    assert.ok(baiduRoute.body.route.distanceMeters > 0);
    assert.match(baiduRoute.body.warning, /not Baidu routing/);

    const routeTripCreated = await api(baseUrl, "/trips", {
      method: "POST",
      headers: jsonHeaders("create-route-trip-1"),
      body: JSON.stringify({
        sourceRouteId: "route-beijing-hutong-art"
      })
    });
    assert.equal(routeTripCreated.response.status, 201);
    const routeTrip = await api(baseUrl, `/trips/${routeTripCreated.body.tripId}`);
    assert.equal(routeTrip.response.status, 200);
    assert.equal(routeTrip.body.stops[0].address, "北京市东城区雍和宫大街12号");
    assert.equal(routeTrip.body.stops[0].latitude, 39.953377859);
    assert.equal(routeTrip.body.stops[0].longitude, 116.42370918);
    assert.equal(routeTrip.body.stops[0].coordSystem, "BD09LL");

    await closeServer(server);
    store.close();

    store = createStore({ filePath: databasePath });
    const persistedTrip = store.getTrip(tripId);
    assert.equal(persistedTrip.revisionId, latestRevisionId);
    assert.equal(persistedTrip.revision, 3);
    const persistedLamaTemple = persistedTrip.stops.find(
      (stop) => stop.clientStopId === imported.body.extraction.stops[0].id
    );
    assert.equal(persistedLamaTemple.address, imported.body.extraction.stops[0].address);
    assert.equal(persistedLamaTemple.latitude, imported.body.extraction.stops[0].lat);
    assert.equal(persistedLamaTemple.longitude, imported.body.extraction.stops[0].lng);
    assert.equal(persistedLamaTemple.coordSystem, "BD09LL");
    assert.equal(store.listExecutionEvents(tripId).length, 1);

    server = createApiServer({ store, logger: { error() {} } });
    baseUrl = await listen(server);
    const reloadedOverHttp = await api(baseUrl, `/trips/${tripId}`);
    assert.equal(reloadedOverHttp.response.status, 200);
    assert.equal(reloadedOverHttp.body.revisionId, latestRevisionId);
    assert.equal(
      reloadedOverHttp.body.stops.find(
        (stop) => stop.clientStopId === imported.body.extraction.stops[0].id
      ).latitude,
      imported.body.extraction.stops[0].lat
    );
  } finally {
    await closeServer(server);
    try {
      store.close();
    } catch {
      // The first store is already closed before the persistence reopen.
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("validation rejects non-user handoff and malformed schedules", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-api-validation-"));
  const databasePath = join(temporaryDirectory, "api.sqlite");
  const store = createStore({ filePath: databasePath });
  const server = createApiServer({ store, logger: { error() {} } });
  const baseUrl = await listen(server);
  try {
    const forbiddenImport = await api(baseUrl, "/imports/xiaohongshu", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        shareUrl: "https://example.com/not-xiaohongshu",
        handoffMode: "USER_INITIATED"
      })
    });
    assert.equal(forbiddenImport.response.status, 400);
    assert.equal(forbiddenImport.body.error.code, "VALIDATION_ERROR");

    const invalidTrip = await api(baseUrl, "/trips", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "重叠行程",
        city: "北京",
        timezone: "Asia/Shanghai",
        status: "DRAFT",
        stops: [
          {
            clientStopId: "one",
            name: "第一站",
            scheduledTime: "09:00",
            durationMinutes: 90,
            note: ""
          },
          {
            clientStopId: "two",
            name: "第二站",
            scheduledTime: "10:00",
            durationMinutes: 60,
            note: ""
          }
        ]
      })
    });
    assert.equal(invalidTrip.response.status, 400);
    assert.equal(invalidTrip.body.error.code, "SCHEDULE_OVERLAP");

    const outOfRangeCoordinates = await api(baseUrl, "/trips", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "越界坐标",
        city: "北京",
        status: "DRAFT",
        stops: [
          {
            clientStopId: "outside-earth",
            name: "错误地点",
            scheduledTime: "09:00",
            durationMinutes: 60,
            latitude: 91,
            longitude: 116.4,
            coordSystem: "BD09"
          }
        ]
      })
    });
    assert.equal(outOfRangeCoordinates.response.status, 400);
    assert.equal(outOfRangeCoordinates.body.error.code, "VALIDATION_ERROR");
    assert.match(outOfRangeCoordinates.body.error.message, /latitude/);

    const unsupportedCoordSystem = await api(baseUrl, "/trips", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "未知坐标系",
        city: "北京",
        status: "DRAFT",
        stops: [
          {
            clientStopId: "unknown-system",
            name: "错误地点",
            scheduledTime: "09:00",
            durationMinutes: 60,
            lat: 39.9,
            lng: 116.4,
            coordSystem: "UNKNOWN"
          }
        ]
      })
    });
    assert.equal(unsupportedCoordSystem.response.status, 400);
    assert.equal(unsupportedCoordSystem.body.error.code, "VALIDATION_ERROR");
    assert.match(unsupportedCoordSystem.body.error.message, /coordSystem/);
  } finally {
    await closeServer(server);
    store.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("Xiaohongshu public metadata is prepared once and idempotently persisted", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-api-preview-"));
  const databasePath = join(temporaryDirectory, "api.sqlite");
  const store = createStore({ filePath: databasePath });
  let previewCalls = 0;
  const providerAdapters = createLocalProviderAdapters({
    store,
    xiaohongshuMetadataResolver: async () => {
      previewCalls += 1;
      return {
        metadataStatus: "PUBLIC_METADATA",
        fallbackCode: null,
        resolvedUrl: "https://www.xiaohongshu.com/explore/note-preview-123",
        title: "北京胡同散步灵感",
        description: "一条适合慢慢走的北京路线。",
        authorName: "公开作者"
      };
    }
  });
  const server = createApiServer({
    store,
    providerAdapters,
    logger: { info() {}, error() {} }
  });
  const baseUrl = await listen(server);
  const request = {
    method: "POST",
    headers: jsonHeaders("public-metadata-import"),
    body: JSON.stringify({
      shareUrl: "https://xhslink.com/a/preview-demo",
      shareText: "北京胡同散步灵感 https://xhslink.com/a/preview-demo",
      handoffMode: "USER_INITIATED"
    })
  };

  try {
    const created = await api(baseUrl, "/imports/xiaohongshu", request);
    assert.equal(created.response.status, 201);
    assert.equal(created.body.source.metadataStatus, "PUBLIC_METADATA");
    assert.equal(created.body.source.providerContentId, "note-preview-123");
    assert.equal(created.body.source.authorName, "公开作者");
    assert.equal(created.body.extraction.mode, "PUBLIC_METADATA_WITH_DEMO_ROUTE");
    assert.match(created.body.extraction.title, /北京胡同散步灵感/);
    assert.ok(created.body.warnings.some((warning) => warning.includes("北京演示模板")));

    const replayed = await api(baseUrl, "/imports/xiaohongshu", request);
    assert.equal(replayed.response.headers.get("idempotency-replayed"), "true");
    assert.equal(replayed.body.importId, created.body.importId);
    assert.equal(previewCalls, 1);
  } finally {
    await closeServer(server);
    store.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("service-token mode isolates owners and preserves incomplete place provenance", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-api-auth-"));
  const databasePath = join(temporaryDirectory, "api.sqlite");
  const store = createStore({ filePath: databasePath });
  const server = createApiServer({
    store,
    corsOrigin: "http://allowed.example",
    authMode: "service-token",
    serviceToken: "test-service-secret",
    requireIdempotency: true,
    logger: { info() {}, error() {} }
  });
  const baseUrl = await listen(server);
  const authHeaders = (userId, idempotencyKey = null) => ({
    Authorization: "Bearer test-service-secret",
    "X-User-Id": userId,
    ...(idempotencyKey ? jsonHeaders(idempotencyKey) : {})
  });

  try {
    const live = await api(baseUrl, "/livez");
    assert.equal(live.response.status, 200);
    const ready = await api(baseUrl, "/readyz");
    assert.equal(ready.response.status, 200);
    assert.equal(ready.body.database.schemaVersion, 7);

    const unauthorized = await api(baseUrl, "/trips");
    assert.equal(unauthorized.response.status, 401);
    assert.equal(unauthorized.body.error.code, "AUTHENTICATION_REQUIRED");

    const deniedOrigin = await api(baseUrl, "/trips", {
      method: "OPTIONS",
      headers: {
        Origin: "https://not-allowed.example",
        "Access-Control-Request-Method": "POST"
      }
    });
    assert.equal(deniedOrigin.response.status, 403);
    assert.equal(deniedOrigin.response.headers.get("access-control-allow-origin"), null);

    const missingIdempotency = await api(baseUrl, "/trips", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-service-secret",
        "X-User-Id": "alice",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    assert.equal(missingIdempotency.response.status, 428);
    assert.equal(missingIdempotency.body.error.code, "IDEMPOTENCY_KEY_REQUIRED");

    const created = await api(baseUrl, "/trips", {
      method: "POST",
      headers: authHeaders("alice", "alice-trip-without-coordinates"),
      body: JSON.stringify({
        title: "待消歧路线",
        city: "北京",
        timezone: "Asia/Shanghai",
        status: "DRAFT",
        source: {
          platform: "XIAOHONGSHU",
          handoffMode: "USER_INITIATED",
          providerContentId: "note-123"
        },
        stops: [{
          clientStopId: "client-stop-1",
          sourceStopId: "source-stop-1",
          placeId: null,
          providerRefs: [{
            provider: "baidu",
            providerPlaceId: "provider-poi-pending-resolution"
          }],
          name: "待确认地点",
          scheduledTime: "09:00",
          durationMinutes: 60,
          latitude: null,
          longitude: null,
          coordSystem: null
        }]
      })
    });
    assert.equal(created.response.status, 201);

    const aliceTrip = await api(baseUrl, `/trips/${created.body.tripId}`, {
      headers: authHeaders("alice")
    });
    assert.equal(aliceTrip.response.status, 200);
    assert.equal(aliceTrip.body.source.providerContentId, "note-123");
    assert.equal(aliceTrip.body.stops[0].sourceStopId, "source-stop-1");
    assert.deepEqual(aliceTrip.body.stops[0].providerRefs, [{
      provider: "baidu",
      providerPlaceId: "provider-poi-pending-resolution"
    }]);
    assert.equal(aliceTrip.body.stops[0].coordSystem, null);

    const bobCannotRead = await api(baseUrl, `/trips/${created.body.tripId}`, {
      headers: authHeaders("bob")
    });
    assert.equal(bobCannotRead.response.status, 404);

    const aliceList = await api(baseUrl, "/trips", {
      headers: authHeaders("alice")
    });
    const bobList = await api(baseUrl, "/trips", {
      headers: authHeaders("bob")
    });
    assert.equal(aliceList.body.total, 1);
    assert.equal(bobList.body.total, 0);
  } finally {
    await closeServer(server);
    store.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("atomic idempotency prevents duplicate writes across SQLite connections", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-api-idempotency-"));
  const databasePath = join(temporaryDirectory, "api.sqlite");
  const bootstrapStore = createStore({ filePath: databasePath });
  bootstrapStore.close();
  const workerUrl = new URL("./idempotency-worker.js", import.meta.url);

  const startWorker = (recordId) => new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, {
      workerData: { databasePath, recordId }
    });
    worker.once("error", reject);
    worker.once("message", (message) => {
      if (message.type !== "ready") {
        reject(new Error(`Unexpected worker message: ${JSON.stringify(message)}`));
        return;
      }
      resolve({
        worker,
        execute: () => new Promise((resolveExecution, rejectExecution) => {
          worker.once("error", rejectExecution);
          worker.once("message", resolveExecution);
          worker.postMessage({ type: "execute" });
        })
      });
    });
  });

  try {
    const [left, right] = await Promise.all([
      startWorker("worker-import-left"),
      startWorker("worker-import-right")
    ]);
    const [leftResult, rightResult] = await Promise.all([
      left.execute(),
      right.execute()
    ]);
    await Promise.all([left.worker.terminate(), right.worker.terminate()]);

    assert.equal(leftResult.ok, true);
    assert.equal(rightResult.ok, true);
    const leftBody = leftResult.result.replayed
      ? leftResult.result.result.response
      : leftResult.result.result.body;
    const rightBody = rightResult.result.replayed
      ? rightResult.result.result.response
      : rightResult.result.result.body;
    assert.equal(
      leftBody.importId,
      rightBody.importId
    );
    assert.equal(
      [leftResult.result.replayed, rightResult.result.replayed].filter(Boolean).length,
      1
    );

    const verified = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(verified.prepare("SELECT COUNT(*) AS count FROM imports").get().count, 1);
      assert.equal(
        verified.prepare("SELECT COUNT(*) AS count FROM idempotency_records").get().count,
        1
      );
    } finally {
      verified.close();
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("opens a legacy stop table with an additive coordinate migration", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-api-migration-"));
  const databasePath = join(temporaryDirectory, "api.sqlite");
  let store;
  try {
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE trip_revision_stops (
        revision_id TEXT NOT NULL,
        client_stop_id TEXT NOT NULL,
        place_id TEXT,
        name TEXT NOT NULL,
        scheduled_time TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        note TEXT NOT NULL,
        locked INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (revision_id, client_stop_id)
      );
      INSERT INTO trip_revision_stops
        (revision_id, client_stop_id, place_id, name, scheduled_time,
         duration_minutes, note, locked, sort_order)
      VALUES
        ('legacy-revision', 'legacy-stop', NULL, '旧库地点', '09:00', 60, '', 0, 0);
    `);
    legacyDatabase.close();

    store = createStore({ filePath: databasePath });
    const columns = new Set(
      store.db.prepare("PRAGMA table_info(trip_revision_stops)").all().map((column) => column.name)
    );
    assert.ok(columns.has("address"));
    assert.ok(columns.has("latitude"));
    assert.ok(columns.has("longitude"));
    assert.ok(columns.has("coord_system"));
    assert.equal(
      store.db.prepare(`
        SELECT name FROM trip_revision_stops
        WHERE revision_id = 'legacy-revision' AND client_stop_id = 'legacy-stop'
      `).get().name,
      "旧库地点"
    );
  } finally {
    try {
      store?.close();
    } catch {
      // Ignore cleanup if opening the migrated store failed.
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("provider lineage migration preserves old operations and scopes call-id uniqueness", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY
      );
      CREATE TABLE trip_revisions (
        id TEXT PRIMARY KEY
      );
      CREATE TABLE agent_operations (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        provider_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        status TEXT NOT NULL,
        base_revision_id TEXT NOT NULL,
        result_revision_id TEXT,
        output_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (run_id, sequence),
        UNIQUE (run_id, provider_call_id)
      );
      CREATE INDEX idx_agent_operations_run_sequence
        ON agent_operations (run_id, sequence);
      INSERT INTO agent_runs (id) VALUES ('run-lineage');
      INSERT INTO trip_revisions (id) VALUES ('revision-lineage');
      INSERT INTO agent_operations (
        id, run_id, sequence, provider_call_id, tool_name, arguments_json,
        status, base_revision_id, result_revision_id, output_json, error_json,
        created_at, updated_at
      ) VALUES (
        'operation-old', 'run-lineage', 1, 'move_stop_0', 'move_stop',
        '{"client_stop_id":"stop-old","new_scheduled_time":"17:30","reason":"old"}',
        'REJECTED', 'revision-lineage', NULL,
        '{"ok":false}', '{"code":"AGENT_REBASED"}',
        '2026-07-25T00:00:00.000Z', '2026-07-25T00:00:01.000Z'
      );
    `);

    migrateAgentOperationsToProviderLineage(database);

    const oldOperation = database.prepare(`
      SELECT * FROM agent_operations WHERE id = 'operation-old'
    `).get();
    assert.equal(oldOperation.provider_lineage, 1);
    assert.equal(oldOperation.provider_call_id, "move_stop_0");
    assert.equal(oldOperation.status, "REJECTED");
    assert.equal(
      JSON.parse(oldOperation.arguments_json).new_scheduled_time,
      "17:30"
    );
    assert.equal(
      database.prepare(`
        SELECT provider_lineage FROM agent_runs WHERE id = 'run-lineage'
      `).get().provider_lineage,
      1
    );

    database.prepare(`
      INSERT INTO agent_operations (
        id, run_id, sequence, provider_lineage, provider_call_id, tool_name,
        arguments_json, status, base_revision_id, result_revision_id,
        output_json, error_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
    `).run(
      "operation-new-lineage",
      "run-lineage",
      2,
      2,
      "move_stop_0",
      "move_stop",
      JSON.stringify({
        client_stop_id: "stop-new",
        new_scheduled_time: "17:45",
        reason: "new"
      }),
      "PENDING",
      "revision-lineage",
      "2026-07-25T00:00:02.000Z",
      "2026-07-25T00:00:02.000Z"
    );
    assert.equal(
      database.prepare(`
        SELECT COUNT(*) AS count
        FROM agent_operations
        WHERE run_id = 'run-lineage' AND provider_call_id = 'move_stop_0'
      `).get().count,
      2
    );
    assert.throws(
      () => database.prepare(`
        INSERT INTO agent_operations (
          id, run_id, sequence, provider_lineage, provider_call_id, tool_name,
          arguments_json, status, base_revision_id, result_revision_id,
          output_json, error_json, created_at, updated_at
        ) VALUES (
          'operation-duplicate', 'run-lineage', 3, 2, 'move_stop_0',
          'move_stop', '{}', 'PENDING', 'revision-lineage',
          NULL, NULL, NULL,
          '2026-07-25T00:00:03.000Z', '2026-07-25T00:00:03.000Z'
        )
      `).run(),
      (error) => error.code === "ERR_SQLITE_ERROR"
    );
  } finally {
    database.close();
  }
});
