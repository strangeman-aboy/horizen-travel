import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentManager } from "../src/agent-manager.js";
import { createScriptedAgentProvider } from "../src/agent-provider.js";
import { createApiServer } from "../src/app.js";
import { createStore } from "../src/store.js";

function deferred() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}/api/v1`;
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function api(baseUrl, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

function jsonHeaders(idempotencyKey = null, revisionId = null) {
  return {
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    ...(revisionId ? { "If-Match": `"${revisionId}"` } : {})
  };
}

function sampleStops() {
  return [
    {
      clientStopId: "stop-a",
      sourceStopId: null,
      placeId: null,
      providerRefs: [],
      name: "早餐",
      scheduledTime: "09:00",
      durationMinutes: 60,
      note: "",
      address: "",
      latitude: null,
      longitude: null,
      coordSystem: null,
      imageUrl: null,
      category: null,
      locked: false
    },
    {
      clientStopId: "stop-b",
      sourceStopId: null,
      placeId: null,
      providerRefs: [],
      name: "展览",
      scheduledTime: "11:00",
      durationMinutes: 60,
      note: "",
      address: "",
      latitude: null,
      longitude: null,
      coordSystem: null,
      imageUrl: null,
      category: null,
      locked: false
    },
    {
      clientStopId: "stop-c",
      sourceStopId: null,
      placeId: null,
      providerRefs: [],
      name: "晚餐",
      scheduledTime: "18:00",
      durationMinutes: 90,
      note: "",
      address: "",
      latitude: null,
      longitude: null,
      coordSystem: null,
      imageUrl: null,
      category: null,
      locked: true
    }
  ];
}

function createDraftTrip(
  store,
  tripId,
  plannerState = {
    constraints: [{ type: "pace", value: "relaxed" }],
    transportModeOverrides: { "stop-a:stop-b": "walking" }
  },
  stops = sampleStops()
) {
  return store.createTrip({
    tripId,
    title: "Agent 测试行程",
    city: "北京",
    timezone: "Asia/Shanghai",
    status: "DRAFT",
    sourceImportId: null,
    sourceUrl: null,
    source: { platform: "IN_APP", handoffMode: "DIRECT" },
    plannerState,
    stops
  });
}

test("Agent persists one revision per tool, ordered cursor events, undo, and restart state", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-agent-complete-"));
  const databasePath = join(temporaryDirectory, "agent.sqlite");
  let store = createStore({ filePath: databasePath });
  const trip = createDraftTrip(store, "trip-agent-complete");
  const provider = createScriptedAgentProvider({
    script: [
      {
        toolName: "move_stop",
        arguments: {
          client_stop_id: "stop-a",
          new_scheduled_time: "09:30",
          reason: "稍晚出发"
        }
      },
      {
        toolName: "set_stop_lock",
        arguments: {
          client_stop_id: "stop-b",
          locked: true,
          reason: "保留预约"
        }
      },
      {
        toolName: "finish_replan",
        arguments: { summary: "已调整出发并锁定预约" }
      }
    ]
  });
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });
  let server = createApiServer({ store, agentManager: manager, logger: { error() {} } });
  let baseUrl = await listen(server);

  try {
    const startRequest = {
      method: "POST",
      headers: jsonHeaders("agent-complete-start", trip.revisionId),
      body: JSON.stringify({
        baseRevisionId: trip.revisionId,
        instruction: "早餐晚半小时，并锁定展览"
      })
    };
    const started = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs`,
      startRequest
    );
    assert.equal(started.response.status, 202);
    assert.equal(started.body.status, "QUEUED");
    assert.equal(
      started.response.headers.get("location"),
      `/api/v1/trips/${trip.tripId}/agent-runs/${started.body.runId}`
    );

    const replayed = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs`,
      startRequest
    );
    assert.equal(replayed.response.status, 202);
    assert.equal(replayed.response.headers.get("idempotency-replayed"), "true");
    assert.equal(replayed.body.runId, started.body.runId);

    await manager.waitForIdle(started.body.runId);
    const loaded = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}`
    );
    assert.equal(loaded.body.status, "COMPLETED");
    assert.equal(loaded.body.operations.length, 3);
    assert.deepEqual(
      loaded.body.operations.map((operation) => operation.sequence),
      [1, 2, 3]
    );
    assert.deepEqual(
      loaded.body.operations.slice(0, 2).map((operation) => operation.resultRevisionId),
      [
        loaded.body.operations[0].resultRevisionId,
        loaded.body.operations[1].resultRevisionId
      ]
    );
    assert.notEqual(
      loaded.body.operations[0].resultRevisionId,
      loaded.body.operations[1].resultRevisionId
    );

    const changedTrip = await api(baseUrl, `/trips/${trip.tripId}`);
    assert.equal(changedTrip.body.revision, 3);
    assert.equal(changedTrip.body.stops[0].scheduledTime, "09:30");
    assert.equal(
      changedTrip.body.stops.find((stop) => stop.clientStopId === "stop-b").locked,
      true
    );
    assert.deepEqual(changedTrip.body.plannerState, trip.plannerState);

    const firstEvents = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}/events?after=0&limit=500`
    );
    assert.equal(firstEvents.response.status, 200);
    assert.equal(firstEvents.body.run.status, "COMPLETED");
    assert.deepEqual(
      firstEvents.body.events.map((event) => event.sequence),
      firstEvents.body.events.map((_, index) => index + 1)
    );
    assert.equal(
      new Set(firstEvents.body.events.map((event) => event.eventId)).size,
      firstEvents.body.events.length
    );
    const appliedEvents = firstEvents.body.events.filter(
      (event) => event.type === "operation.applied"
    );
    assert.equal(appliedEvents.length, 3);
    assert.equal(appliedEvents[0].payload.trip.tripId, trip.tripId);
    assert.ok(Array.isArray(appliedEvents[0].payload.trip.stops));
    assert.deepEqual(appliedEvents[0].payload.trip.plannerState, trip.plannerState);

    const emptyCursorPage = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}/events?after=${firstEvents.body.nextCursor}&limit=10`
    );
    assert.deepEqual(emptyCursorPage.body.events, []);
    assert.equal(emptyCursorPage.body.nextCursor, firstEvents.body.nextCursor);

    const staleUndo = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}/undo`,
      {
      method: "POST",
      headers: jsonHeaders("agent-undo-stale", trip.revisionId),
      body: "{}"
      }
    );
    assert.equal(staleUndo.response.status, 409);
    assert.equal(staleUndo.body.error.code, "REVISION_CONFLICT");

    const undone = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}/undo`,
      {
      method: "POST",
      headers: jsonHeaders("agent-undo-current", changedTrip.body.revisionId),
      body: "{}"
      }
    );
    assert.equal(undone.response.status, 200);
    assert.equal(undone.body.run.status, "UNDONE");
    assert.equal(undone.body.trip.revision, 4);
    assert.equal(undone.body.trip.stops[0].scheduledTime, "09:00");
    assert.equal(
      undone.body.trip.stops.find((stop) => stop.clientStopId === "stop-b").locked,
      false
    );
    assert.deepEqual(undone.body.trip.plannerState, trip.plannerState);

    const undoEvents = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}/events?after=${firstEvents.body.nextCursor}&limit=10`
    );
    const undoApplied = undoEvents.body.events.find((event) => event.type === "undo.applied");
    assert.equal(undoApplied.payload.trip.revisionId, undone.body.trip.revisionId);
    assert.deepEqual(undoApplied.payload.trip.plannerState, trip.plannerState);

    await closeServer(server);
    store.close();
    store = createStore({ filePath: databasePath });
    assert.equal(store.getAgentRun(started.body.runId).status, "UNDONE");
    const persistedEvents = store.listAgentEvents(started.body.runId, "demo-user", {
      after: 0,
      limit: 500
    });
    assert.equal(persistedEvents.run.status, "UNDONE");
    assert.equal(
      persistedEvents.events.at(-1).sequence,
      undoEvents.body.nextCursor
    );

    server = createApiServer({ store, logger: { error() {} } });
    baseUrl = await listen(server);
    const restartedRun = await api(baseUrl, `/agent-runs/${started.body.runId}`);
    assert.equal(restartedRun.body.status, "UNDONE");
  } finally {
    await closeServer(server);
    try {
      store.close();
    } catch {
      // Store may already be closed before the restart assertion.
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("pause allows a revisioned manual takeover and resume rebases before replanning", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-agent-pause-"));
  const databasePath = join(temporaryDirectory, "agent.sqlite");
  const store = createStore({ filePath: databasePath });
  const trip = createDraftTrip(store, "trip-agent-pause");
  const firstProviderCallStarted = deferred();
  const releaseFirstProviderCall = deferred();
  let callCount = 0;
  const provider = {
    available: true,
    providerName: "fake",
    modelName: "fake-gated",
    async nextToolCall({ run, previousResponseId }) {
      callCount += 1;
      if (callCount === 1) {
        firstProviderCallStarted.resolve();
        await releaseFirstProviderCall.promise;
      }
      if (callCount <= 2) {
        return {
          responseId: `fake-response-${callCount}`,
          call: {
            providerCallId: `fake-call-${callCount}`,
            toolName: "move_stop",
            arguments: {
              client_stop_id: "stop-a",
              new_scheduled_time: callCount === 1 ? "09:30" : "09:45",
              reason: "根据最新人工约束重新安排"
            }
          },
          previousResponseId
        };
      }
      return {
        responseId: `fake-response-${callCount}`,
        call: {
          providerCallId: `fake-call-${callCount}`,
          toolName: "finish_replan",
          arguments: { summary: "人工接管后已重新规划" }
        }
      };
    }
  };
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });
  const server = createApiServer({ store, agentManager: manager, logger: { error() {} } });
  const baseUrl = await listen(server);

  try {
    const started = await api(baseUrl, `/trips/${trip.tripId}/agent-runs`, {
      method: "POST",
      headers: jsonHeaders("agent-pause-start", trip.revisionId),
      body: JSON.stringify({
        baseRevisionId: trip.revisionId,
        instruction: "请稍晚出发"
      })
    });
    await firstProviderCallStarted.promise;

    const pause = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}/commands`,
      {
      method: "POST",
      headers: jsonHeaders("agent-pause-command"),
      body: JSON.stringify({ command: "PAUSE" })
      }
    );
    assert.equal(pause.response.status, 202);
    assert.equal(pause.body.status, "PAUSE_REQUESTED");
    releaseFirstProviderCall.resolve();
    await manager.waitForIdle(started.body.runId);

    const paused = await api(baseUrl, `/agent-runs/${started.body.runId}`);
    assert.equal(paused.body.status, "PAUSED");
    assert.equal(paused.body.operations[0].status, "PENDING");
    const unchangedTrip = await api(baseUrl, `/trips/${trip.tripId}`);
    assert.equal(unchangedTrip.body.revision, 1);

    const manualPlannerState = {
      constraints: [{ type: "unavailable", start: "08:00", end: "09:30" }],
      transportModeOverrides: { "stop-a:stop-b": "transit" }
    };
    const manual = await api(baseUrl, `/trips/${trip.tripId}/schedule`, {
      method: "PUT",
      headers: jsonHeaders("manual-takeover", unchangedTrip.body.revisionId),
      body: JSON.stringify({
        baseRevisionId: unchangedTrip.body.revisionId,
        status: "CONFIRMED",
        plannerState: manualPlannerState,
        stops: unchangedTrip.body.stops
      })
    });
    assert.equal(manual.response.status, 200);
    assert.equal(manual.body.status, "CONFIRMED");
    assert.equal(manual.body.revision, 2);
    assert.deepEqual(manual.body.plannerState, manualPlannerState);

    const missingRebase = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}/commands`,
      {
        method: "POST",
        headers: jsonHeaders("agent-resume-without-revision"),
        body: JSON.stringify({ command: "RESUME" })
      }
    );
    assert.equal(missingRebase.response.status, 409);
    assert.equal(missingRebase.body.error.code, "AGENT_RESUME_REVISION_REQUIRED");

    const resumed = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}/commands`,
      {
      method: "POST",
      headers: jsonHeaders("agent-resume-current", manual.body.revisionId),
      body: JSON.stringify({
        command: "RESUME",
        baseRevisionId: manual.body.revisionId
      })
      }
    );
    assert.equal(resumed.response.status, 202);
    assert.equal(resumed.body.status, "RESUMING");
    await manager.waitForIdle(started.body.runId);

    const completed = await api(baseUrl, `/agent-runs/${started.body.runId}`);
    assert.equal(completed.body.status, "COMPLETED");
    assert.deepEqual(
      completed.body.operations.map((operation) => operation.status),
      ["REJECTED", "APPLIED", "APPLIED"]
    );
    const finalTrip = await api(baseUrl, `/trips/${trip.tripId}`);
    assert.equal(finalTrip.body.status, "CONFIRMED");
    assert.equal(finalTrip.body.revision, 3);
    assert.equal(finalTrip.body.stops[0].scheduledTime, "09:45");
    assert.deepEqual(finalTrip.body.plannerState, manualPlannerState);

    const historical = await api(
      baseUrl,
      `/trips/${trip.tripId}/revisions/${trip.revisionId}`
    );
    assert.equal(historical.body.status, "CONFIRMED");
    assert.deepEqual(historical.body.plannerState, trip.plannerState);
    const events = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}/events?after=0&limit=500`
    );
    assert.ok(events.body.events.some((event) => event.type === "run.rebased"));
    const appliedAfterRebase = events.body.events
      .filter((event) => event.type === "operation.applied")
      .find((event) => event.payload.trip.revision === 3);
    assert.deepEqual(appliedAfterRebase.payload.trip.plannerState, manualPlannerState);
  } finally {
    await closeServer(server);
    store.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("stop is durable at a provider boundary and stale run starts return 409", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-agent-stop-"));
  const store = createStore({ filePath: join(temporaryDirectory, "agent.sqlite") });
  const trip = createDraftTrip(store, "trip-agent-stop");
  const providerStarted = deferred();
  const releaseProvider = deferred();
  let providerCalls = 0;
  const provider = {
    available: true,
    providerName: "fake",
    modelName: "fake-stop",
    async nextToolCall({ run }) {
      providerCalls += 1;
      providerStarted.resolve();
      await releaseProvider.promise;
      return {
        responseId: `fake-response-${run.runId}`,
        call: {
          providerCallId: `fake-call-${run.runId}`,
          toolName: "move_stop",
          arguments: {
            client_stop_id: "stop-a",
            new_scheduled_time: "09:30",
            reason: "测试停止边界"
          }
        }
      };
    }
  };
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });
  const server = createApiServer({ store, agentManager: manager, logger: { error() {} } });
  const baseUrl = await listen(server);

  try {
    const started = await api(baseUrl, `/trips/${trip.tripId}/agent-runs`, {
      method: "POST",
      headers: jsonHeaders("agent-stop-start", trip.revisionId),
      body: JSON.stringify({
        baseRevisionId: trip.revisionId,
        instruction: "测试停止"
      })
    });
    await providerStarted.promise;
    const stop = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}/commands`,
      {
      method: "POST",
      headers: jsonHeaders("agent-stop-command"),
      body: JSON.stringify({ command: "STOP" })
      }
    );
    assert.equal(stop.response.status, 202);
    assert.equal(stop.body.status, "STOP_REQUESTED");
    releaseProvider.resolve();
    await manager.waitForIdle(started.body.runId);

    const stopped = await api(baseUrl, `/agent-runs/${started.body.runId}`);
    assert.equal(stopped.body.status, "STOPPED");
    assert.equal(stopped.body.operations[0].status, "PENDING");
    const unchanged = await api(baseUrl, `/trips/${trip.tripId}`);
    assert.equal(unchanged.body.revision, 1);

    const invalidResume = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}/commands`,
      {
        method: "POST",
        headers: jsonHeaders("agent-stop-resume"),
        body: JSON.stringify({ command: "RESUME" })
      }
    );
    assert.equal(invalidResume.response.status, 409);
    assert.equal(invalidResume.body.error.code, "INVALID_AGENT_COMMAND");

    const manuallyChanged = store.saveSchedule({
      tripId: trip.tripId,
      baseRevisionId: trip.revisionId,
      stops: trip.stops,
      reason: "TEST_STALE_START"
    });
    const staleStart = await api(baseUrl, `/trips/${trip.tripId}/agent-runs`, {
      method: "POST",
      headers: jsonHeaders("agent-stale-start", trip.revisionId),
      body: JSON.stringify({
        baseRevisionId: trip.revisionId,
        instruction: "不应调用 provider"
      })
    });
    assert.equal(staleStart.response.status, 409);
    assert.equal(staleStart.body.error.code, "REVISION_CONFLICT");
    assert.equal(providerCalls, 1);
    assert.equal(store.getTrip(trip.tripId).revisionId, manuallyChanged.revisionId);

    const events = await api(
      baseUrl,
      `/trips/${trip.tripId}/agent-runs/${started.body.runId}/events?after=0&limit=500`
    );
    assert.ok(events.body.events.some((event) => event.type === "run.stopped"));
    assert.deepEqual(
      events.body.events.map((event) => event.sequence),
      [...new Set(events.body.events.map((event) => event.sequence))]
    );
  } finally {
    await closeServer(server);
    store.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rejected operations return the canonical trip and an equivalent retry converges", async () => {
  const store = createStore({ filePath: ":memory:" });
  const trip = createDraftTrip(store, "trip-agent-rejection-convergence");
  const providerContexts = [];
  let callCount = 0;
  const provider = {
    available: true,
    providerName: "fake",
    modelName: "fake-rejection-convergence",
    async nextToolCall(context) {
      callCount += 1;
      providerContexts.push(structuredClone({
        previousResponseId: context.previousResponseId,
        toolResult: context.toolResult
      }));
      const moveArguments = {
        client_stop_id: "stop-a",
        new_scheduled_time: "11:00",
        reason: "move into an occupied slot"
      };
      if (callCount <= 2) {
        return {
          responseId: `fake-convergence-response-${callCount}`,
          call: {
            providerCallId: `fake-convergence-call-${callCount}`,
            toolName: "move_stop",
            arguments: moveArguments
          }
        };
      }
      if (callCount === 3) {
        return {
          responseId: "fake-convergence-response-3",
          call: {
            providerCallId: "fake-convergence-call-3",
            toolName: "move_stop",
            arguments: {
              client_stop_id: "stop-b",
              new_scheduled_time: "14:30",
              reason: "move the later affected stop out of the unavailable window"
            }
          }
        };
      }
      if (callCount === 4) {
        return {
          responseId: "fake-convergence-response-4",
          call: {
            providerCallId: "fake-convergence-call-4",
            toolName: "move_stop",
            arguments: {
              client_stop_id: "stop-a",
              new_scheduled_time: "13:00",
              reason: "move the remaining affected stop into a free slot"
            }
          }
        };
      }
      return {
        responseId: "fake-convergence-response-5",
        call: {
          providerCallId: "fake-convergence-call-5",
          toolName: "finish_replan",
          arguments: { summary: "converged after using the canonical trip" }
        }
      };
    }
  };
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} },
    maxSteps: 24
  });

  try {
    const run = manager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "上午有事，请把行程移到下午"
    });
    await manager.waitForIdle(run.runId);

    assert.equal(callCount, 5);
    assert.equal(
      providerContexts[1].toolResult.output.error.code,
      "UNAVAILABLE_WINDOW_CONFLICT"
    );
    assert.equal(providerContexts[1].toolResult.output.trip.revisionId, trip.revisionId);
    assert.deepEqual(
      providerContexts[1].toolResult.output.trip.stops.map((stop) => stop.scheduledTime),
      ["09:00", "11:00", "18:00"]
    );
    assert.equal(
      providerContexts[2].toolResult.output.error.code,
      "DUPLICATE_REJECTED_OPERATION"
    );
    assert.equal(providerContexts[2].toolResult.output.trip.revisionId, trip.revisionId);
    assert.equal(providerContexts[3].toolResult.output.ok, true);
    assert.equal(providerContexts[3].toolResult.output.trip.revision, 2);
    assert.equal(
      providerContexts[3].toolResult.output.trip.stops.find(
        (stop) => stop.clientStopId === "stop-b"
      ).scheduledTime,
      "14:30"
    );
    assert.equal(providerContexts[4].toolResult.output.ok, true);
    assert.equal(providerContexts[4].toolResult.output.trip.revision, 3);
    assert.equal(
      providerContexts[4].toolResult.output.trip.stops.find(
        (stop) => stop.clientStopId === "stop-a"
      ).scheduledTime,
      "13:00"
    );

    const completed = store.getAgentRun(run.runId);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.error, null);
    assert.deepEqual(
      completed.operations.map((operation) => operation.status),
      ["REJECTED", "REJECTED", "APPLIED", "APPLIED", "APPLIED"]
    );
  } finally {
    store.close();
  }
});

test("hard unavailable windows reject invalid moves and premature finish before converging", async () => {
  const store = createStore({ filePath: ":memory:" });
  const trip = createDraftTrip(store, "trip-agent-hard-unavailable");
  const providerContexts = [];
  const script = [
    {
      toolName: "move_stop",
      arguments: {
        client_stop_id: "stop-a",
        new_scheduled_time: "10:00",
        reason: "invalid attempt inside the blocked morning"
      }
    },
    {
      toolName: "finish_replan",
      arguments: {
        summary: "invalid premature completion"
      }
    },
    {
      toolName: "move_stop",
      arguments: {
        client_stop_id: "stop-b",
        new_scheduled_time: "14:30",
        reason: "move the later affected stop first"
      }
    },
    {
      toolName: "move_stop",
      arguments: {
        client_stop_id: "stop-a",
        new_scheduled_time: "13:00",
        reason: "move the remaining affected stop"
      }
    },
    {
      toolName: "finish_replan",
      arguments: {
        summary: "all morning conflicts were moved to the afternoon"
      }
    }
  ];
  let callCount = 0;
  const provider = {
    available: true,
    providerName: "fake",
    modelName: "fake-hard-unavailable",
    async nextToolCall(context) {
      providerContexts.push(structuredClone({
        derivedConstraints: context.derivedConstraints,
        toolResult: context.toolResult
      }));
      const step = script[callCount];
      callCount += 1;
      return {
        responseId: `fake-hard-unavailable-response-${callCount}`,
        call: {
          providerCallId: `fake-hard-unavailable-call-${callCount}`,
          ...step
        }
      };
    }
  };
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });

  try {
    const run = manager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "我周六上午有事，请帮我重新规划。保留14:30已经预约的景山公园。"
    });
    await manager.waitForIdle(run.runId);

    assert.equal(callCount, 5);
    assert.equal(
      providerContexts[0].derivedConstraints.unavailableWindows[0].id,
      "saturday-morning"
    );
    assert.equal(
      providerContexts[1].toolResult.output.error.code,
      "UNAVAILABLE_WINDOW_CONFLICT"
    );
    assert.deepEqual(
      providerContexts[1].toolResult.output.error.details.offendingStops.map(
        (stop) => stop.clientStopId
      ),
      ["stop-a"]
    );
    assert.equal(
      providerContexts[2].toolResult.output.error.code,
      "REPLAN_CONSTRAINTS_UNSATISFIED"
    );
    assert.deepEqual(
      providerContexts[2].toolResult.output.error.details.offendingStops.map(
        (stop) => stop.clientStopId
      ),
      ["stop-a", "stop-b"]
    );
    assert.equal(
      providerContexts[2].toolResult.output.planningHints
        .remainingConflictCount,
      2
    );
    assert.equal(
      providerContexts[2].toolResult.output.error.details.planningHints
        .remainingConflictCount,
      2
    );
    assert.equal(providerContexts[2].toolResult.output.trip.revision, 1);

    const firstSuccessfulTrip = providerContexts[3].toolResult.output.trip;
    assert.equal(
      providerContexts[3].toolResult.output.derivedConstraints
        .unavailableWindows[0].id,
      "saturday-morning"
    );
    assert.equal(
      providerContexts[3].toolResult.output.planningHints
        .remainingConflictCount,
      1
    );
    assert.equal(firstSuccessfulTrip.revision, 2);
    assert.deepEqual(
      firstSuccessfulTrip.plannerState.constraints,
      [
        { type: "pace", value: "relaxed" },
        {
          id: "saturday-morning",
          type: "unavailable",
          startTime: "09:00",
          endTime: "12:00",
          evidence: "我周六上午有事",
          source: "agent_instruction",
          hard: true
        }
      ]
    );
    assert.deepEqual(firstSuccessfulTrip.plannerState.transportModeOverrides, {
      "stop-a:stop-b": "walking"
    });

    const beforeFinish = providerContexts[4].toolResult.output.trip;
    assert.equal(beforeFinish.revision, 3);
    assert.deepEqual(
      beforeFinish.stops.map((stop) => stop.scheduledTime),
      ["13:00", "14:30", "18:00"]
    );

    const completed = store.getAgentRun(run.runId);
    assert.equal(completed.status, "COMPLETED");
    assert.deepEqual(
      completed.operations.map((operation) => operation.status),
      ["REJECTED", "REJECTED", "APPLIED", "APPLIED", "APPLIED"]
    );
    assert.equal(
      completed.operations.at(-1).output.trip.revisionId,
      completed.resultRevisionId
    );

    const finalTrip = store.getTrip(trip.tripId);
    assert.equal(finalTrip.revision, 3);
    assert.deepEqual(
      finalTrip.stops.map((stop) => stop.scheduledTime),
      ["13:00", "14:30", "18:00"]
    );
    assert.equal(
      finalTrip.plannerState.constraints.filter(
        (constraint) => constraint.id === "saturday-morning"
      ).length,
      1
    );

    const events = store.listAgentEvents(run.runId, "demo-user", {
      after: 0,
      limit: 500
    }).events;
    const completedEvent = events.find((event) => event.type === "run.completed");
    assert.equal(completedEvent.payload.trip.revisionId, finalTrip.revisionId);
    assert.deepEqual(completedEvent.payload.trip.plannerState, finalTrip.plannerState);
  } finally {
    store.close();
  }
});

test("a locked stop conflicting with an unavailable window fails before the provider runs", () => {
  const store = createStore({ filePath: ":memory:" });
  const stops = sampleStops();
  stops[0] = { ...stops[0], locked: true };
  const trip = createDraftTrip(
    store,
    "trip-agent-locked-unavailable",
    {
      constraints: [{ type: "pace", value: "relaxed" }],
      transportModeOverrides: {}
    },
    stops
  );
  let providerCalls = 0;
  const manager = createAgentManager({
    store,
    provider: {
      available: true,
      providerName: "fake",
      modelName: "fake-locked-unavailable",
      async nextToolCall() {
        providerCalls += 1;
        throw new Error("provider must not be called");
      }
    },
    logger: { error() {} }
  });

  try {
    assert.throws(
      () => manager.startRun({
        tripId: trip.tripId,
        ownerUserId: "demo-user",
        baseRevisionId: trip.revisionId,
        instruction: "我周六上午有事，请帮我重新规划"
      }),
      (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.code, "LOCKED_STOP_CONSTRAINT_CONFLICT");
        assert.deepEqual(
          error.details[0].offendingStops.map((stop) => stop.clientStopId),
          ["stop-a"]
        );
        assert.equal(
          error.details[0].derivedConstraints.unavailableWindows[0].id,
          "saturday-morning"
        );
        assert.equal(error.details[0].trip.revisionId, trip.revisionId);
        return true;
      }
    );
    assert.equal(providerCalls, 0);
    assert.deepEqual(store.listRecoverableAgentRuns(), []);
    assert.deepEqual(store.getTrip(trip.tripId).plannerState, trip.plannerState);
  } finally {
    store.close();
  }
});

test("finish-only replans persist a reversible constraint revision and canonical events", async () => {
  const store = createStore({ filePath: ":memory:" });
  const afternoonStops = sampleStops().map((stop) => {
    if (stop.clientStopId === "stop-a") {
      return { ...stop, scheduledTime: "13:00" };
    }
    if (stop.clientStopId === "stop-b") {
      return { ...stop, scheduledTime: "14:30" };
    }
    return stop;
  });
  const originalPlannerState = {
    constraints: [{ type: "pace", value: "relaxed" }],
    transportModeOverrides: { "stop-a:stop-b": "walking" }
  };
  const trip = createDraftTrip(
    store,
    "trip-agent-finish-only",
    originalPlannerState,
    afternoonStops
  );
  const provider = createScriptedAgentProvider({
    script: [{
      toolName: "finish_replan",
      arguments: {
        summary: "原行程已避开上午，只需记录新的硬约束"
      }
    }]
  });
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });

  try {
    const run = manager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "我周六上午有事，请帮我重新规划"
    });
    await manager.waitForIdle(run.runId);

    const completed = store.getAgentRun(run.runId);
    const constrainedTrip = store.getTrip(trip.tripId);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(constrainedTrip.revision, 2);
    assert.equal(completed.resultRevisionId, constrainedTrip.revisionId);
    assert.equal(completed.currentRevisionId, constrainedTrip.revisionId);
    assert.equal(completed.operations.length, 1);
    assert.equal(completed.operations[0].status, "APPLIED");
    assert.equal(
      completed.operations[0].resultRevisionId,
      constrainedTrip.revisionId
    );
    assert.equal(
      completed.operations[0].output.trip.revisionId,
      constrainedTrip.revisionId
    );
    assert.equal(
      completed.operations[0].output.derivedConstraints
        .unavailableWindows[0].id,
      "saturday-morning"
    );
    assert.deepEqual(
      completed.operations[0].output.trip.plannerState,
      constrainedTrip.plannerState
    );
    assert.deepEqual(
      constrainedTrip.plannerState.constraints,
      [
        { type: "pace", value: "relaxed" },
        {
          id: "saturday-morning",
          type: "unavailable",
          startTime: "09:00",
          endTime: "12:00",
          evidence: "我周六上午有事",
          source: "agent_instruction",
          hard: true
        }
      ]
    );
    assert.deepEqual(
      constrainedTrip.plannerState.transportModeOverrides,
      originalPlannerState.transportModeOverrides
    );
    assert.deepEqual(constrainedTrip.stops, trip.stops);

    const beforeUndoEvents = store.listAgentEvents(run.runId, "demo-user", {
      after: 0,
      limit: 500
    }).events;
    const appliedEvent = beforeUndoEvents.find(
      (event) => event.type === "operation.applied"
    );
    const completedEvent = beforeUndoEvents.find(
      (event) => event.type === "run.completed"
    );
    assert.equal(appliedEvent.payload.trip.revisionId, constrainedTrip.revisionId);
    assert.equal(completedEvent.payload.trip.revisionId, constrainedTrip.revisionId);
    assert.deepEqual(
      completedEvent.payload.trip.plannerState,
      constrainedTrip.plannerState
    );

    const undone = manager.undo(
      run.runId,
      "demo-user",
      constrainedTrip.revisionId
    );
    assert.equal(undone.run.status, "UNDONE");
    assert.equal(undone.trip.revision, 3);
    assert.deepEqual(undone.trip.stops, trip.stops);
    assert.deepEqual(undone.trip.plannerState, originalPlannerState);
    assert.equal(
      undone.trip.plannerState.constraints.some(
        (constraint) => constraint.id === "saturday-morning"
      ),
      false
    );

    const afterUndoEvents = store.listAgentEvents(run.runId, "demo-user", {
      after: 0,
      limit: 500
    }).events;
    const undoEvent = afterUndoEvents.find((event) => event.type === "undo.applied");
    assert.equal(undoEvent.payload.trip.revisionId, undone.trip.revisionId);
    assert.deepEqual(undoEvent.payload.trip.plannerState, originalPlannerState);
  } finally {
    store.close();
  }
});

function sixStopUndoStops() {
  const template = sampleStops()[0];
  return [
    ["stop-1", "上午活动一", "09:00", 60, false],
    ["stop-2", "上午活动二", "10:30", 60, false],
    ["stop-3", "午餐", "12:00", 60, false],
    ["stop-4", "预约活动", "13:30", 60, true],
    ["stop-5", "下午活动", "15:00", 60, false],
    ["stop-6", "傍晚活动", "16:15", 60, false]
  ].map(([clientStopId, name, scheduledTime, durationMinutes, locked]) => ({
    ...template,
    clientStopId,
    name,
    scheduledTime,
    durationMinutes,
    locked
  }));
}

test("undo reverses only Agent changes after a paused manual rebase", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-agent-undo-rebase-"));
  const databasePath = join(temporaryDirectory, "agent.sqlite");
  let store = createStore({ filePath: databasePath });
  const trip = createDraftTrip(
    store,
    "trip-agent-undo-rebase",
    {
      constraints: [{ id: "initial-pace", type: "pace", value: "relaxed" }],
      transportModeOverrides: {}
    },
    sixStopUndoStops()
  );
  const firstProviderStarted = deferred();
  const releaseFirstProvider = deferred();
  const firstProvider = {
    available: true,
    providerName: "fake",
    modelName: "fake-undo-before-rebase",
    async nextToolCall() {
      firstProviderStarted.resolve();
      await releaseFirstProvider.promise;
      return {
        responseId: "fake-undo-before-rebase-response",
        call: {
          providerCallId: "move_stop_0",
          toolName: "move_stop",
          arguments: {
            client_stop_id: "stop-2",
            new_scheduled_time: "17:15",
            reason: "stale move before the manual edit"
          }
        }
      };
    }
  };
  const firstManager = createAgentManager({
    store,
    provider: firstProvider,
    logger: { error() {} }
  });

  try {
    const run = firstManager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "我周六上午有事，请帮我重新规划"
    });
    await firstProviderStarted.promise;
    assert.equal(
      firstManager.command(run.runId, "demo-user", "pause").status,
      "PAUSE_REQUESTED"
    );
    releaseFirstProvider.resolve();
    await firstManager.waitForIdle(run.runId);
    assert.equal(store.getAgentRunInternal(run.runId).status, "PAUSED");

    const manualPlannerState = {
      constraints: [{
        id: "manual-break",
        type: "preference",
        value: "keep-evening-break"
      }],
      transportModeOverrides: {
        "stop-5:stop-6": "walking"
      }
    };
    const manualTrip = store.saveSchedule({
      tripId: trip.tripId,
      baseRevisionId: trip.revisionId,
      stops: trip.stops.map((stop) => (
        stop.clientStopId === "stop-6"
          ? { ...stop, scheduledTime: "16:30" }
          : stop
      )),
      plannerState: manualPlannerState,
      reason: "TEST_MANUAL_STOP6_EDIT"
    });
    assert.equal(manualTrip.revision, 2);
    assert.equal(
      manualTrip.stops.find((stop) => stop.clientStopId === "stop-6")
        .scheduledTime,
      "16:30"
    );

    store.close();
    store = createStore({ filePath: databasePath });
    let resumedCallCount = 0;
    const resumedProvider = {
      available: true,
      providerName: "fake",
      modelName: "fake-undo-after-rebase",
      async nextToolCall() {
        resumedCallCount += 1;
        if (resumedCallCount === 1) {
          return {
            responseId: "fake-undo-after-rebase-response-1",
            call: {
              providerCallId: "move_stop_0",
              toolName: "move_stop",
              arguments: {
                client_stop_id: "stop-2",
                new_scheduled_time: "17:30",
                reason: "move the later morning conflict after the manual stop"
              }
            }
          };
        }
        if (resumedCallCount === 2) {
          return {
            responseId: "fake-undo-after-rebase-response-2",
            call: {
              providerCallId: "move_stop_1",
              toolName: "move_stop",
              arguments: {
                client_stop_id: "stop-1",
                new_scheduled_time: "18:30",
                reason: "move the remaining morning conflict"
              }
            }
          };
        }
        return {
          responseId: "fake-undo-after-rebase-response-3",
          call: {
            providerCallId: "finish_replan_2",
            toolName: "finish_replan",
            arguments: {
              summary: "both morning conflicts were moved"
            }
          }
        };
      }
    };
    const resumedManager = createAgentManager({
      store,
      provider: resumedProvider,
      logger: { error() {} }
    });
    assert.equal(
      resumedManager.command(
        run.runId,
        "demo-user",
        "resume",
        { baseRevisionId: manualTrip.revisionId }
      ).status,
      "RESUMING"
    );
    await resumedManager.waitForIdle(run.runId);

    const completed = store.getAgentRunInternal(run.runId);
    const agentTrip = store.getTrip(trip.tripId);
    assert.equal(completed.status, "COMPLETED");
    assert.deepEqual(
      completed.operations.map((operation) => operation.status),
      ["REJECTED", "APPLIED", "APPLIED", "APPLIED"]
    );
    assert.equal(
      agentTrip.stops.find((stop) => stop.clientStopId === "stop-6")
        .scheduledTime,
      "16:30"
    );
    assert.equal(
      agentTrip.stops.find((stop) => stop.clientStopId === "stop-2")
        .scheduledTime,
      "17:30"
    );
    assert.equal(
      agentTrip.stops.find((stop) => stop.clientStopId === "stop-1")
        .scheduledTime,
      "18:30"
    );
    assert.equal(
      agentTrip.plannerState.constraints.some(
        (constraint) => constraint.id === "saturday-morning"
      ),
      true
    );

    const undone = resumedManager.undo(
      run.runId,
      "demo-user",
      agentTrip.revisionId
    );
    assert.equal(undone.run.status, "UNDONE");
    assert.equal(
      undone.trip.stops.find((stop) => stop.clientStopId === "stop-1")
        .scheduledTime,
      "09:00"
    );
    assert.equal(
      undone.trip.stops.find((stop) => stop.clientStopId === "stop-2")
        .scheduledTime,
      "10:30"
    );
    assert.equal(
      undone.trip.stops.find((stop) => stop.clientStopId === "stop-6")
        .scheduledTime,
      "16:30"
    );
    assert.deepEqual(undone.trip.plannerState, manualPlannerState);
    assert.equal(
      undone.trip.plannerState.constraints.some(
        (constraint) => constraint.id === "saturday-morning"
      ),
      false
    );
    assert.deepEqual(
      undone.undo.revertedOperationIds.sort(),
      completed.operations
        .filter((operation) => (
          operation.toolName === "move_stop" &&
          operation.status === "APPLIED"
        ))
        .map((operation) => operation.operationId)
        .sort()
    );
    assert.deepEqual(undone.undo.preservedOperations, []);
    assert.deepEqual(undone.undo.removedConstraintIds, ["saturday-morning"]);

    const undoEvent = store.listAgentEvents(run.runId, "demo-user", {
      after: 0,
      limit: 500
    }).events.find((event) => event.type === "undo.applied");
    assert.equal(
      undoEvent.payload.trip.stops.find(
        (stop) => stop.clientStopId === "stop-6"
      ).scheduledTime,
      "16:30"
    );
    assert.deepEqual(
      undoEvent.payload.trip.plannerState,
      manualPlannerState
    );
  } finally {
    try {
      store.close();
    } catch {
      // Store may already be closed before restart assertions.
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("undo restores the complete stop removed by an Agent operation", async () => {
  const store = createStore({ filePath: ":memory:" });
  const trip = createDraftTrip(store, "trip-agent-undo-remove");
  const provider = createScriptedAgentProvider({
    script: [
      {
        toolName: "remove_stop",
        arguments: {
          client_stop_id: "stop-a",
          reason: "the user explicitly requested deleting breakfast"
        }
      },
      {
        toolName: "finish_replan",
        arguments: { summary: "breakfast removed as requested" }
      }
    ]
  });
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });

  try {
    const run = manager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "请删除早餐"
    });
    await manager.waitForIdle(run.runId);
    const completedTrip = store.getTrip(trip.tripId);
    assert.equal(completedTrip.stops.length, 2);

    const undone = manager.undo(
      run.runId,
      "demo-user",
      completedTrip.revisionId
    );
    assert.equal(undone.trip.stops.length, 3);
    assert.deepEqual(
      undone.trip.stops.find((stop) => stop.clientStopId === "stop-a"),
      trip.stops.find((stop) => stop.clientStopId === "stop-a")
    );
  } finally {
    store.close();
  }
});

test("undo preserves a user's newer value on the same stop after rebase", async () => {
  const store = createStore({ filePath: ":memory:" });
  const trip = createDraftTrip(store, "trip-agent-undo-user-wins");
  const secondProviderCallStarted = deferred();
  const releaseSecondProviderCall = deferred();
  let callCount = 0;
  const provider = {
    available: true,
    providerName: "fake",
    modelName: "fake-undo-user-wins",
    async nextToolCall() {
      callCount += 1;
      if (callCount === 1) {
        return {
          responseId: "fake-undo-user-wins-response-1",
          call: {
            providerCallId: "move_stop_0",
            toolName: "move_stop",
            arguments: {
              client_stop_id: "stop-a",
              new_scheduled_time: "09:30",
              reason: "move breakfast later"
            }
          }
        };
      }
      if (callCount === 2) {
        secondProviderCallStarted.resolve();
        await releaseSecondProviderCall.promise;
        return {
          responseId: "fake-undo-user-wins-stale-response",
          call: {
            providerCallId: "finish_replan_1",
            toolName: "finish_replan",
            arguments: { summary: "stale completion before manual takeover" }
          }
        };
      }
      return {
        responseId: "fake-undo-user-wins-response-3",
        call: {
          providerCallId: "finish_replan_1",
          toolName: "finish_replan",
          arguments: { summary: "manual breakfast time preserved" }
        }
      };
    }
  };
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });

  try {
    const run = manager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "Move breakfast thirty minutes later."
    });
    await secondProviderCallStarted.promise;
    const agentTrip = store.getTrip(trip.tripId);
    assert.equal(
      agentTrip.stops.find((stop) => stop.clientStopId === "stop-a")
        .scheduledTime,
      "09:30"
    );

    assert.equal(
      manager.command(run.runId, "demo-user", "pause").status,
      "PAUSE_REQUESTED"
    );
    releaseSecondProviderCall.resolve();
    await manager.waitForIdle(run.runId);
    assert.equal(store.getAgentRunInternal(run.runId).status, "PAUSED");

    const manualPlannerState = {
      constraints: [{
        id: "manual-breakfast-note",
        type: "preference",
        value: "keep-my-10am-breakfast"
      }],
      transportModeOverrides: {
        "stop-a:stop-b": "transit"
      }
    };
    const manualTrip = store.saveSchedule({
      tripId: trip.tripId,
      baseRevisionId: agentTrip.revisionId,
      stops: agentTrip.stops.map((stop) => (
        stop.clientStopId === "stop-a"
          ? { ...stop, scheduledTime: "10:00" }
          : stop
      )),
      plannerState: manualPlannerState,
      reason: "TEST_MANUAL_SAME_STOP_OVERRIDE"
    });

    assert.equal(
      manager.command(
        run.runId,
        "demo-user",
        "resume",
        { baseRevisionId: manualTrip.revisionId }
      ).status,
      "RESUMING"
    );
    await manager.waitForIdle(run.runId);
    const completed = store.getAgentRunInternal(run.runId);
    const completedTrip = store.getTrip(trip.tripId);
    const appliedMove = completed.operations.find(
      (operation) => (
        operation.toolName === "move_stop" &&
        operation.status === "APPLIED"
      )
    );
    assert.equal(completed.status, "COMPLETED");
    assert.ok(appliedMove);
    assert.equal(
      completedTrip.stops.find((stop) => stop.clientStopId === "stop-a")
        .scheduledTime,
      "10:00"
    );

    const undone = manager.undo(
      run.runId,
      "demo-user",
      completedTrip.revisionId
    );
    assert.equal(
      undone.trip.stops.find((stop) => stop.clientStopId === "stop-a")
        .scheduledTime,
      "10:00"
    );
    assert.deepEqual(undone.trip.plannerState, manualPlannerState);
    assert.equal(
      undone.undo.revertedOperationIds.includes(appliedMove.operationId),
      false
    );
    assert.deepEqual(
      undone.undo.preservedOperations,
      [{
        operationId: appliedMove.operationId,
        toolName: "move_stop",
        reason: "USER_VALUE_TAKES_PRECEDENCE"
      }]
    );
  } finally {
    store.close();
  }
});

test("moving a stop to its current time is a rejected no-op and creates no revision", async () => {
  const store = createStore({ filePath: ":memory:" });
  const trip = createDraftTrip(store, "trip-agent-no-op-move");
  let callCount = 0;
  const provider = {
    available: true,
    providerName: "fake",
    modelName: "fake-no-op-move",
    async nextToolCall() {
      callCount += 1;
      if (callCount === 1) {
        return {
          responseId: "fake-no-op-response-1",
          call: {
            providerCallId: "fake-no-op-call-1",
            toolName: "move_stop",
            arguments: {
              client_stop_id: "stop-c",
              new_scheduled_time: "18:00",
              reason: "leave it where it already is"
            }
          }
        };
      }
      return {
        responseId: "fake-no-op-response-2",
        call: {
          providerCallId: "fake-no-op-call-2",
          toolName: "finish_replan",
          arguments: { summary: "the existing trip already satisfies the request" }
        }
      };
    }
  };
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });

  try {
    const run = manager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "保持14:30已经预约的活动，其余行程无需改变"
    });
    await manager.waitForIdle(run.runId);

    const completed = store.getAgentRun(run.runId);
    const unchangedTrip = store.getTrip(trip.tripId);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(callCount, 2);
    assert.deepEqual(
      completed.operations.map((operation) => operation.status),
      ["REJECTED", "APPLIED"]
    );
    assert.equal(
      completed.operations[0].error.code,
      "NO_OP_OPERATION"
    );
    assert.deepEqual(
      completed.operations[0].error.details,
      {
        clientStopId: "stop-c",
        currentScheduledTime: "18:00",
        requestedScheduledTime: "18:00",
        planningHints: completed.operations[0].output.planningHints
      }
    );
    assert.equal(completed.operations[0].resultRevisionId, null);
    assert.equal(completed.operations[0].output.trip.revisionId, trip.revisionId);
    assert.equal(completed.operations[1].resultRevisionId, trip.revisionId);
    assert.equal(unchangedTrip.revision, 1);
    assert.deepEqual(unchangedTrip.stops, trip.stops);
    assert.deepEqual(unchangedTrip.plannerState, trip.plannerState);
  } finally {
    store.close();
  }
});

test("setting an already-matching lock state is a rejected no-op with no revision", async () => {
  const store = createStore({ filePath: ":memory:" });
  const trip = createDraftTrip(store, "trip-agent-lock-no-op");
  let callCount = 0;
  const provider = {
    available: true,
    providerName: "fake",
    modelName: "fake-lock-no-op",
    async nextToolCall() {
      callCount += 1;
      if (callCount === 1) {
        return {
          responseId: "fake-lock-no-op-response-1",
          call: {
            providerCallId: "fake-lock-no-op-call-1",
            toolName: "set_stop_lock",
            arguments: {
              client_stop_id: "stop-c",
              locked: true,
              reason: "lock an already locked reservation"
            }
          }
        };
      }
      return {
        responseId: "fake-lock-no-op-response-2",
        call: {
          providerCallId: "fake-lock-no-op-call-2",
          toolName: "finish_replan",
          arguments: { summary: "the reservation was already locked" }
        }
      };
    }
  };
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });

  try {
    const run = manager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "请保留已经锁定的晚餐预约"
    });
    await manager.waitForIdle(run.runId);

    const completed = store.getAgentRun(run.runId);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(callCount, 2);
    assert.deepEqual(
      completed.operations.map((operation) => operation.status),
      ["REJECTED", "APPLIED"]
    );
    assert.equal(completed.operations[0].error.code, "NO_OP_OPERATION");
    assert.deepEqual(
      completed.operations[0].error.details,
      {
        clientStopId: "stop-c",
        currentLocked: true,
        requestedLocked: true,
        planningHints: completed.operations[0].output.planningHints
      }
    );
    assert.equal(
      completed.operations[0].output.planningHints
        .allDerivedConstraintsSatisfied,
      true
    );
    assert.equal(completed.operations[0].resultRevisionId, null);
    assert.equal(completed.operations[1].resultRevisionId, trip.revisionId);
    assert.equal(store.getTrip(trip.tripId).revision, 1);
    assert.deepEqual(store.getTrip(trip.tripId).stops, trip.stops);
  } finally {
    store.close();
  }
});

test("remove_stop is rejected with feasible suggested move times by default", async () => {
  const store = createStore({ filePath: ":memory:" });
  const trip = createDraftTrip(store, "trip-agent-removal-not-required");
  const providerContexts = [];
  const script = [
    {
      toolName: "remove_stop",
      arguments: {
        client_stop_id: "stop-a",
        reason: "remove the first morning stop"
      }
    },
    {
      toolName: "move_stop",
      arguments: {
        client_stop_id: "stop-b",
        new_scheduled_time: "14:30",
        reason: "preserve it in the afternoon"
      }
    },
    {
      toolName: "move_stop",
      arguments: {
        client_stop_id: "stop-a",
        new_scheduled_time: "13:00",
        reason: "use a feasible suggested afternoon slot"
      }
    },
    {
      toolName: "finish_replan",
      arguments: {
        summary: "all stops were preserved outside the blocked morning"
      }
    }
  ];
  let callCount = 0;
  const provider = {
    available: true,
    providerName: "fake",
    modelName: "fake-removal-not-required",
    async nextToolCall(context) {
      providerContexts.push(structuredClone({
        toolResult: context.toolResult
      }));
      const step = script[callCount];
      callCount += 1;
      return {
        responseId: `fake-removal-response-${callCount}`,
        call: {
          providerCallId: `fake-removal-call-${callCount}`,
          ...step
        }
      };
    }
  };
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });

  try {
    const run = manager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "我周六上午有事，请帮我重新规划"
    });
    await manager.waitForIdle(run.runId);

    const rejection = providerContexts[1].toolResult.output;
    assert.equal(rejection.error.code, "REMOVAL_NOT_REQUIRED");
    assert.deepEqual(
      rejection.error.details.suggestedTimes,
      ["12:00", "12:15", "12:30", "12:45", "13:00"]
    );
    assert.equal(rejection.trip.revisionId, trip.revisionId);
    assert.equal(rejection.trip.stops.length, 3);

    const completed = store.getAgentRun(run.runId);
    const finalTrip = store.getTrip(trip.tripId);
    assert.equal(completed.status, "COMPLETED");
    assert.deepEqual(
      completed.operations.map((operation) => operation.status),
      ["REJECTED", "APPLIED", "APPLIED", "APPLIED"]
    );
    assert.equal(finalTrip.stops.length, 3);
    assert.deepEqual(
      finalTrip.stops.map((stop) => stop.scheduledTime),
      ["13:00", "14:30", "18:00"]
    );
  } finally {
    store.close();
  }
});

function sixStopConvergenceStops() {
  const template = sampleStops()[0];
  return [
    ["stop-1", "上午活动", "09:00", 60, false],
    ["stop-2", "午餐", "12:00", 90, false],
    ["stop-3", "胡同散步", "13:30", 60, false],
    ["stop-4", "景山公园预约", "14:30", 90, true],
    ["stop-5", "咖啡休息", "16:00", 90, false],
    ["stop-6", "傍晚活动", "17:30", 120, false]
  ].map(([clientStopId, name, scheduledTime, durationMinutes, locked]) => ({
    ...template,
    clientStopId,
    name,
    scheduledTime,
    durationMinutes,
    locked
  }));
}

test("planningHints converge a six-stop trip without deletion in at most six steps", async () => {
  const store = createStore({ filePath: ":memory:" });
  const trip = createDraftTrip(
    store,
    "trip-agent-six-stop-hints",
    {
      constraints: [{ type: "pace", value: "relaxed" }],
      transportModeOverrides: {}
    },
    sixStopConvergenceStops()
  );
  const observedHints = [];
  let callCount = 0;
  const provider = {
    available: true,
    providerName: "fake",
    modelName: "fake-planning-hints",
    async nextToolCall(context) {
      callCount += 1;
      const hints = context.toolResult?.output?.planningHints
        ?? context.planningHints;
      observedHints.push(structuredClone(hints));
      const candidate = hints.nextActionCandidates[0];
      return {
        responseId: `fake-hints-response-${callCount}`,
        call: {
          providerCallId: `fake-hints-call-${callCount}`,
          toolName: candidate.toolName,
          arguments: structuredClone(candidate.arguments)
        }
      };
    }
  };
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });

  try {
    const run = manager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "我周六上午有事，请帮我重新规划。保留14:30已经预约的景山公园。"
    });
    await manager.waitForIdle(run.runId);

    const completed = store.getAgentRun(run.runId);
    const finalTrip = store.getTrip(trip.tripId);
    assert.equal(completed.status, "COMPLETED");
    assert.ok(callCount <= 6);
    assert.equal(callCount, 2);
    assert.deepEqual(
      completed.operations.map((operation) => operation.toolName),
      ["move_stop", "finish_replan"]
    );
    assert.deepEqual(
      completed.operations.map((operation) => operation.status),
      ["APPLIED", "APPLIED"]
    );

    assert.equal(observedHints[0].remainingConflictCount, 1);
    assert.equal(
      observedHints[0].constraintConflicts[0].clientStopId,
      "stop-1"
    );
    assert.deepEqual(
      observedHints[0].constraintConflicts[0].suggestedTimes,
      ["19:30", "19:45", "20:00", "20:15", "20:30"]
    );
    assert.equal(
      observedHints[0].nextActionCandidates[0]
        .arguments.new_scheduled_time,
      "19:30"
    );
    assert.equal(observedHints[1].remainingConflictCount, 0);
    assert.equal(observedHints[1].allDerivedConstraintsSatisfied, true);
    assert.equal(
      observedHints[1].nextActionCandidates[0].toolName,
      "finish_replan"
    );

    assert.equal(finalTrip.stops.length, 6);
    assert.equal(
      finalTrip.stops.find((stop) => stop.clientStopId === "stop-1")
        .scheduledTime,
      "19:30"
    );
    const lockedReservation = finalTrip.stops.find(
      (stop) => stop.clientStopId === "stop-4"
    );
    assert.equal(lockedReservation.scheduledTime, "14:30");
    assert.equal(lockedReservation.locked, true);
    assert.equal(
      completed.operations.at(-1).output.planningHints
        .allDerivedConstraintsSatisfied,
      true
    );
    assert.equal(
      finalTrip.plannerState.constraints.some(
        (constraint) => constraint.id === "saturday-morning"
      ),
      true
    );
  } finally {
    store.close();
  }
});

test("an explicit affirmative deletion instruction may override feasible move times", async () => {
  const store = createStore({ filePath: ":memory:" });
  const trip = createDraftTrip(store, "trip-agent-explicit-removal");
  const provider = createScriptedAgentProvider({
    script: [
      {
        toolName: "remove_stop",
        arguments: {
          client_stop_id: "stop-a",
          reason: "the user explicitly allowed deleting breakfast"
        }
      },
      {
        toolName: "move_stop",
        arguments: {
          client_stop_id: "stop-b",
          new_scheduled_time: "13:00",
          reason: "move the remaining morning stop"
        }
      },
      {
        toolName: "finish_replan",
        arguments: {
          summary: "breakfast was removed with permission and the rest was preserved"
        }
      }
    ]
  });
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });

  try {
    const run = manager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "我周六上午有事，如果排不下可以删除早餐"
    });
    await manager.waitForIdle(run.runId);

    const completed = store.getAgentRun(run.runId);
    const finalTrip = store.getTrip(trip.tripId);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.operations[0].status, "APPLIED");
    assert.equal(completed.operations[0].toolName, "remove_stop");
    assert.equal(finalTrip.stops.some((stop) => stop.clientStopId === "stop-a"), false);
    assert.equal(
      finalTrip.stops.find((stop) => stop.clientStopId === "stop-b").scheduledTime,
      "13:00"
    );
  } finally {
    store.close();
  }
});

function fullDayRemovalTestStops() {
  const [target, , lockedAfternoon] = sampleStops();
  return [
    {
      ...target,
      name: "上午长活动",
      scheduledTime: "00:00",
      durationMinutes: 720,
      locked: false
    },
    {
      ...lockedAfternoon,
      clientStopId: "stop-day-end",
      name: "下午锁定活动",
      scheduledTime: "12:00",
      durationMinutes: 720,
      locked: true
    }
  ];
}

test("remove_stop remains a last resort when no same-day feasible time exists", async () => {
  const store = createStore({ filePath: ":memory:" });
  const trip = createDraftTrip(
    store,
    "trip-agent-last-resort-removal",
    {
      constraints: [],
      transportModeOverrides: {}
    },
    fullDayRemovalTestStops()
  );
  const provider = createScriptedAgentProvider({
    script: [
      {
        toolName: "remove_stop",
        arguments: {
          client_stop_id: "stop-a",
          reason: "no valid same-day slot remains"
        }
      },
      {
        toolName: "finish_replan",
        arguments: {
          summary: "removed only the impossible-to-place stop"
        }
      }
    ]
  });
  const manager = createAgentManager({
    store,
    provider,
    logger: { error() {} }
  });

  try {
    const run = manager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "上午有事，请重新规划"
    });
    await manager.waitForIdle(run.runId);

    const completed = store.getAgentRun(run.runId);
    const finalTrip = store.getTrip(trip.tripId);
    assert.equal(completed.status, "COMPLETED");
    assert.deepEqual(
      completed.operations.map((operation) => operation.status),
      ["APPLIED", "APPLIED"]
    );
    assert.deepEqual(
      finalTrip.stops.map((stop) => stop.clientStopId),
      ["stop-day-end"]
    );
  } finally {
    store.close();
  }
});

test("an explicit negative deletion instruction blocks removal even without a feasible slot", async () => {
  const store = createStore({ filePath: ":memory:" });
  const trip = createDraftTrip(
    store,
    "trip-agent-forbidden-removal",
    {
      constraints: [],
      transportModeOverrides: {}
    },
    fullDayRemovalTestStops()
  );
  let providerCalls = 0;
  const manager = createAgentManager({
    store,
    provider: {
      available: true,
      providerName: "fake",
      modelName: "fake-forbidden-removal",
      async nextToolCall() {
        providerCalls += 1;
        return {
          responseId: "fake-forbidden-removal-response",
          call: {
            providerCallId: "fake-forbidden-removal-call",
            toolName: "remove_stop",
            arguments: {
              client_stop_id: "stop-a",
              reason: "invalid removal despite the user's negative instruction"
            }
          }
        };
      }
    },
    logger: { error() {} },
    maxSteps: 1
  });

  try {
    const run = manager.startRun({
      tripId: trip.tripId,
      ownerUserId: "demo-user",
      baseRevisionId: trip.revisionId,
      instruction: "上午有事，但不要删除任何行程，也不想取消活动"
    });
    await manager.waitForIdle(run.runId);

    const failed = store.getAgentRun(run.runId);
    assert.equal(providerCalls, 1);
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.error.code, "AGENT_STEP_LIMIT_EXCEEDED");
    assert.equal(failed.operations.length, 1);
    assert.equal(failed.operations[0].status, "REJECTED");
    assert.equal(
      failed.operations[0].error.code,
      "REMOVAL_NOT_AUTHORIZED"
    );
    assert.deepEqual(failed.operations[0].error.details.suggestedTimes, []);
    assert.equal(store.getTrip(trip.tripId).revision, 1);
    assert.deepEqual(store.getTrip(trip.tripId).stops, trip.stops);
  } finally {
    store.close();
  }
});
