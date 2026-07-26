import assert from "node:assert/strict";
import test from "node:test";

import {
  agentRunReducer,
  createInitialAgentRunState,
  ingestAgentRunEvents,
} from "../src/agent/agentRunReducer.js";

function acceptedRunningState() {
  return agentRunReducer(
    createInitialAgentRunState({
      phase: "starting",
      instruction: "把上午留空",
      messages: [{ id: "user-1", role: "user", text: "把上午留空" }],
    }),
    {
      type: "RUN_ACCEPTED",
      run: {
        runId: "run-1",
        tripId: "trip-1",
        status: "RUNNING",
        baseRevisionId: "rev-1",
        headRevisionId: "rev-1",
        eventCursor: 0,
      },
    },
  );
}

test("event ingestion sorts out-of-order events and ignores duplicate sequences", () => {
  const state = acceptedRunningState();
  const result = ingestAgentRunEvents(state, [
    {
      runId: "run-1",
      seq: 2,
      type: "operation.started",
      payload: {
        operation: {
          operationId: "op-2",
          type: "stop.protect",
          targetClientStopId: "4",
        },
      },
    },
    {
      runId: "run-1",
      seq: 1,
      type: "operation.started",
      payload: {
        operation: {
          operationId: "op-1",
          type: "constraint.add",
        },
      },
    },
    {
      runId: "run-1",
      seq: 1,
      type: "operation.started",
      payload: {
        operation: {
          operationId: "duplicate-op",
          type: "stop.move",
        },
      },
    },
  ]);

  assert.deepEqual(result.acceptedEvents.map((event) => event.sequence), [1, 2]);
  assert.deepEqual(result.state.operations.map((operation) => operation.operationId), ["op-1", "op-2"]);
  assert.equal(result.state.previewOperation.operationId, "op-2");
  assert.equal(result.state.lastSequence, 2);

  const duplicatePage = ingestAgentRunEvents(result.state, [{
    runId: "run-1",
    seq: 2,
    type: "operation.started",
    payload: { operation: { operationId: "op-2" } },
  }]);
  assert.equal(duplicatePage.acceptedEvents.length, 0);
  assert.equal(duplicatePage.state, result.state);
});

test("operation.started only previews and operation.applied commits the visible result", () => {
  const state = acceptedRunningState();
  const started = ingestAgentRunEvents(state, [{
    runId: "run-1",
    seq: 1,
    type: "operation.started",
    headRevision: "rev-1",
    payload: {
      operation: {
        operationId: "op-move",
        type: "stop.move",
        targetClientStopId: "1",
        before: { scheduledTime: "09:00" },
        after: { scheduledTime: "16:15" },
      },
    },
  }]).state;

  assert.equal(started.previewOperation.operationId, "op-move");
  assert.equal(started.operations[0].status, "STARTED");
  assert.deepEqual(started.changedStopIds, []);
  assert.equal(started.headRevisionId, "rev-1");

  const applied = ingestAgentRunEvents(started, [{
    runId: "run-1",
    seq: 2,
    type: "operation.applied",
    headRevision: "rev-2",
    payload: {
      operation: {
        operationId: "op-move",
        type: "stop.move",
        targetClientStopId: 1,
        resultRevisionId: "rev-2",
      },
      trip: { tripId: "trip-1", revisionId: "rev-2" },
    },
  }]).state;

  assert.equal(applied.previewOperation, null);
  assert.equal(applied.operations[0].status, "APPLIED");
  assert.deepEqual(applied.changedStopIds, ["1"]);
  assert.equal(applied.headRevisionId, "rev-2");
});

test("backend operation.pending rows are normalized into a visible move preview", () => {
  const pending = ingestAgentRunEvents(acceptedRunningState(), [{
    runId: "run-1",
    sequence: 1,
    type: "operation.pending",
    payload: {
      operation: {
        operationId: "op-backend-move",
        toolName: "move_stop",
        status: "PENDING",
        arguments: {
          client_stop_id: "2",
          new_scheduled_time: "15:45",
          reason: "Morning is unavailable",
        },
      },
    },
  }]).state;

  assert.equal(pending.previewOperation.operationId, "op-backend-move");
  assert.equal(pending.previewOperation.type, "move_stop");
  assert.equal(pending.previewOperation.status, "STARTED");
  assert.equal(pending.previewOperation.targetClientStopId, "2");
  assert.deepEqual(pending.previewOperation.after, { scheduledTime: "15:45" });
  assert.equal(pending.previewOperation.reason, "Morning is unavailable");
});

test("pause becomes paused only after a server PAUSED acknowledgement", () => {
  const requested = agentRunReducer(acceptedRunningState(), {
    type: "COMMAND_REQUESTED",
    command: "PAUSE",
  });
  assert.equal(requested.phase, "pausing");
  assert.equal(requested.pendingCommand.command, "PAUSE");

  const accepted = agentRunReducer(requested, {
    type: "COMMAND_ACKNOWLEDGED",
    run: {
      runId: "run-1",
      tripId: "trip-1",
      status: "PAUSE_REQUESTED",
      baseRevisionId: "rev-1",
      headRevisionId: "rev-1",
    },
  });
  assert.equal(accepted.phase, "pausing");
  assert.equal(accepted.pendingCommand.acknowledged, true);

  const paused = ingestAgentRunEvents(accepted, [{
    runId: "run-1",
    seq: 1,
    type: "run.status",
    payload: { status: "PAUSED" },
  }]).state;
  assert.equal(paused.phase, "paused");
  assert.equal(paused.pendingCommand, null);
});

test("backend run.paused and run.resume_requested events drive the control phase", () => {
  const pauseRequested = agentRunReducer(acceptedRunningState(), {
    type: "COMMAND_REQUESTED",
    command: "PAUSE",
  });
  const paused = ingestAgentRunEvents(pauseRequested, [{
    runId: "run-1",
    sequence: 1,
    type: "run.paused",
    payload: { status: "PAUSED" },
  }]).state;

  assert.equal(paused.phase, "paused");
  assert.equal(paused.pendingCommand, null);

  const resuming = ingestAgentRunEvents(paused, [{
    runId: "run-1",
    sequence: 2,
    type: "run.resume_requested",
    payload: { status: "RESUMING" },
  }]).state;

  assert.equal(resuming.phase, "resuming");
});

test("stop keeps the run stopping until the server reports STOPPED", () => {
  const requested = agentRunReducer(acceptedRunningState(), {
    type: "COMMAND_REQUESTED",
    command: "STOP",
  });
  assert.equal(requested.phase, "stopping");

  const acknowledged = agentRunReducer(requested, {
    type: "COMMAND_ACKNOWLEDGED",
    run: {
      runId: "run-1",
      tripId: "trip-1",
      status: "STOP_REQUESTED",
      baseRevisionId: "rev-1",
      headRevisionId: "rev-2",
    },
  });
  assert.equal(acknowledged.phase, "stopping");
  assert.equal(acknowledged.pendingCommand.command, "STOP");

  const stopped = ingestAgentRunEvents(acknowledged, [{
    runId: "run-1",
    seq: 3,
    type: "run.stopped",
    headRevision: "rev-2",
    payload: {},
  }]).state;
  assert.equal(stopped.phase, "stopped");
  assert.equal(stopped.headRevisionId, "rev-2");
  assert.equal(stopped.pendingCommand, null);
});

test("undo.applied clears changed markers and marks applied operations undone", () => {
  const withAppliedOperation = ingestAgentRunEvents(acceptedRunningState(), [{
    runId: "run-1",
    seq: 1,
    type: "operation.applied",
    headRevision: "rev-2",
    payload: {
      operation: {
        operationId: "op-1",
        type: "stop.move",
        targetClientStopId: "1",
      },
    },
  }]).state;
  const undoing = agentRunReducer(withAppliedOperation, { type: "UNDO_REQUESTED" });
  assert.equal(undoing.phase, "undoing");

  const undone = ingestAgentRunEvents(undoing, [{
    runId: "run-1",
    seq: 2,
    type: "undo.applied",
    headRevision: "rev-3",
    payload: {
      trip: { tripId: "trip-1", revisionId: "rev-3" },
    },
  }]).state;

  assert.equal(undone.phase, "idle");
  assert.equal(undone.undoApplied, true);
  assert.equal(undone.operations[0].status, "UNDONE");
  assert.deepEqual(undone.changedStopIds, []);
  assert.equal(undone.headRevisionId, "rev-3");
});

test("revision conflicts enter conflicted without erasing the instruction or operations", () => {
  const state = ingestAgentRunEvents(acceptedRunningState(), [{
    runId: "run-1",
    seq: 1,
    type: "operation.started",
    payload: {
      operation: {
        operationId: "op-1",
        type: "stop.move",
        targetClientStopId: "1",
      },
    },
  }]).state;
  const conflicted = agentRunReducer(state, {
    type: "COMMAND_FAILED",
    error: {
      status: 409,
      code: "REVISION_CONFLICT",
      message: "stale revision",
      details: [{ currentRevisionId: "rev-9" }],
    },
  });

  assert.equal(conflicted.phase, "conflicted");
  assert.equal(conflicted.instruction, "把上午留空");
  assert.equal(conflicted.operations.length, 1);
  assert.equal(conflicted.conflict.currentRevisionId, "rev-9");
});
