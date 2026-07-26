import assert from "node:assert/strict";
import test from "node:test";

import { ApiRequestError } from "../src/api/travelApi.js";
import { createAgentRunApi } from "../src/api/agentRunApi.js";

function createRecordingApi(handler) {
  const requests = [];
  return {
    requests,
    api: {
      async request(path, options = {}) {
        requests.push({ path, options });
        return handler(path, options, requests.length);
      },
    },
  };
}

test("startRun sends instruction, base revision, If-Match and an idempotency key", async () => {
  const recording = createRecordingApi(async () => ({
    runId: "run-1",
    tripId: "trip 1",
    status: "PLANNING",
    baseRevisionId: "rev-1",
    headRevisionId: "rev-1",
    eventCursor: 0,
  }));
  const api = createAgentRunApi({ api: recording.api });

  const run = await api.startRun({
    tripId: "trip 1",
    instruction: "周六上午留空",
    baseRevisionId: "rev-1",
  });

  assert.equal(run.runId, "run-1");
  assert.equal(run.phase, "planning");
  assert.equal(recording.requests[0].path, "/trips/trip%201/agent-runs");
  assert.equal(recording.requests[0].options.headers["If-Match"], "\"rev-1\"");
  assert.match(
    recording.requests[0].options.idempotencyKey,
    /^route-story-agent-run-start-/u,
  );
  assert.deepEqual(recording.requests[0].options.body, {
    instruction: "周六上午留空",
    baseRevisionId: "rev-1",
  });
});

test("event pages use a stable after-sequence cursor and normalize event fields", async () => {
  const recording = createRecordingApi(async () => ({
    events: [{
      runId: "run-1",
      seq: 8,
      type: "operation.applied",
      headRevision: "rev-2",
      payload: {
        operation: {
          operationId: "op-1",
          type: "stop.move",
          targetClientStopId: "1",
        },
      },
    }],
    nextSequence: 8,
  }));
  const api = createAgentRunApi({ api: recording.api });

  const page = await api.listRunEvents({
    tripId: "trip-1",
    runId: "run/1",
    afterSequence: 7,
    limit: 500,
  });

  assert.equal(
    recording.requests[0].path,
    "/trips/trip-1/agent-runs/run%2F1/events?after=7&limit=100",
  );
  assert.equal(page.events[0].sequence, 8);
  assert.equal(page.events[0].headRevisionId, "rev-2");
  assert.equal(page.events[0].operation.operationId, "op-1");
});

test("resume carries the latest base revision while pause and stop wait for server status", async () => {
  const recording = createRecordingApi(async (path, options) => ({
    runId: "run-1",
    tripId: "trip-1",
    status: options.body.command === "PAUSE"
      ? "PAUSE_REQUESTED"
      : options.body.command === "STOP"
        ? "STOP_REQUESTED"
        : "RUNNING",
    baseRevisionId: options.body.baseRevisionId ?? "rev-1",
    headRevisionId: options.body.baseRevisionId ?? "rev-1",
  }));
  const api = createAgentRunApi({ api: recording.api });

  const pause = await api.pauseRun({ tripId: "trip-1", runId: "run-1" });
  const resume = await api.resumeRun({
    tripId: "trip-1",
    runId: "run-1",
    baseRevisionId: "rev-manual-2",
  });
  const stop = await api.stopRun({ tripId: "trip-1", runId: "run-1" });

  assert.equal(pause.phase, "pausing");
  assert.equal(resume.phase, "running");
  assert.equal(stop.phase, "stopping");
  assert.deepEqual(recording.requests.map(({ options }) => options.body), [
    { command: "PAUSE" },
    { command: "RESUME", baseRevisionId: "rev-manual-2" },
    { command: "STOP" },
  ]);
  recording.requests.forEach(({ options }) => {
    assert.match(options.idempotencyKey, /^route-story-agent-run-command-/u);
  });
});

test("resume rejects a missing base revision before issuing a request", async () => {
  const recording = createRecordingApi(async () => ({}));
  const api = createAgentRunApi({ api: recording.api });

  await assert.rejects(
    api.resumeRun({ tripId: "trip-1", runId: "run-1" }),
    (error) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.code, "MISSING_REVISION_ID");
      return true;
    },
  );
  assert.equal(recording.requests.length, 0);
});

test("undo uses the current trip revision as If-Match and preserves the committed trip", async () => {
  const recording = createRecordingApi(async () => ({
    run: {
      runId: "run-1",
      tripId: "trip-1",
      status: "UNDONE",
      baseRevisionId: "rev-1",
      currentRevisionId: "rev-4",
    },
    trip: {
      tripId: "trip-1",
      revisionId: "rev-4",
      revision: 4,
      stops: [{ clientStopId: "1", scheduledTime: "09:00" }],
    },
  }));
  const api = createAgentRunApi({ api: recording.api });

  const result = await api.undoRun({
    tripId: "trip-1",
    runId: "run-1",
    expectedRevisionId: "rev-3",
  });

  assert.equal(result.phase, "idle");
  assert.equal(result.committedTrip.revisionId, "rev-4");
  assert.equal(
    recording.requests[0].path,
    "/trips/trip-1/agent-runs/run-1/undo",
  );
  assert.equal(recording.requests[0].options.headers["If-Match"], "\"rev-3\"");
  assert.deepEqual(recording.requests[0].options.body, {});
  assert.match(
    recording.requests[0].options.idempotencyKey,
    /^route-story-agent-run-undo-/u,
  );
});

test("event subscription reconnects from the last accepted sequence", async () => {
  const observedAfter = [];
  let attempt = 0;
  const recording = createRecordingApi(async (path) => {
    const after = Number(new URL(`http://local${path}`).searchParams.get("after"));
    observedAfter.push(after);
    attempt += 1;
    if (attempt === 1) {
      return {
        events: [{
          runId: "run-1",
          seq: 2,
          type: "run.status",
          payload: { status: "RUNNING" },
        }],
      };
    }
    if (attempt === 2) {
      throw new ApiRequestError("temporary disconnect", {
        code: "API_UNREACHABLE",
        retryable: true,
      });
    }
    return {
      events: [{
        runId: "run-1",
        seq: 3,
        type: "run.completed",
        payload: {},
      }],
    };
  });
  const api = createAgentRunApi({
    api: recording.api,
    pollIntervalMs: 0,
    maxReconnectDelayMs: 1,
  });
  const events = [];
  const connections = [];

  const result = await api.subscribeRunEvents({
    tripId: "trip-1",
    runId: "run-1",
    afterSequence: 0,
    onEvent: (event) => events.push(event),
    onConnectionChange: (connection) => connections.push(connection),
    shouldStop: () => events.some((event) => event.type === "run.completed"),
  });

  assert.deepEqual(observedAfter, [0, 2, 2]);
  assert.deepEqual(events.map((event) => event.sequence), [2, 3]);
  assert.equal(result.lastSequence, 3);
  assert.ok(connections.includes("reconnecting"));
  assert.equal(connections.at(-1), "closed");
});

test("subscription surfaces revision conflicts instead of retrying them", async () => {
  let attempts = 0;
  const recording = createRecordingApi(async () => {
    attempts += 1;
    throw new ApiRequestError("stale", {
      status: 409,
      code: "REVISION_CONFLICT",
      retryable: false,
    });
  });
  const api = createAgentRunApi({
    api: recording.api,
    pollIntervalMs: 0,
    maxReconnectDelayMs: 1,
  });

  await assert.rejects(
    api.subscribeRunEvents({
      tripId: "trip-1",
      runId: "run-1",
    }),
    (error) => {
      assert.equal(error.code, "REVISION_CONFLICT");
      return true;
    },
  );
  assert.equal(attempts, 1);
});
