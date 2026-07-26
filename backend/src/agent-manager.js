import { randomUUID } from "node:crypto";
import {
  deriveAgentConstraints,
  findUnavailableWindowConflicts,
  mergeDerivedConstraintsIntoPlannerState
} from "./agent-constraints.js";
import {
  buildAgentPlanningHints,
  findFeasibleTimesForStop
} from "./agent-planning.js";
import { AgentProviderError } from "./agent-provider.js";

const TERMINAL_STATUSES = new Set([
  "STOPPED",
  "COMPLETED",
  "FAILED",
  "CONFLICTED",
  "UNDONE"
]);
const ALLOWED_TOOLS = new Set([
  "move_stop",
  "set_stop_lock",
  "remove_stop",
  "finish_replan"
]);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/;
const NEGATED_REMOVAL_PATTERN =
  /(?:不要|不想|不想要|不能|不可|不许|不用|不需要|可以不|可不|别|禁止|避免|无需|千万别).{0,10}(?:删除|删掉|删去|删|取消|移除|去掉|放弃)|不\s*(?:删除|删掉|删去|删|取消|移除|去掉|放弃)|不(?:把|将).{0,12}(?:删除|删掉|删去|删|取消|移除|去掉|放弃)|(?:do\s+not|don't|never)\s+(?:delete|remove|cancel)/iu;
const AFFIRMATIVE_REMOVAL_PATTERN =
  /(?:请|可以|允许|同意|直接|决定|确认|必须|需要|想要|我要|帮我).{0,12}(?:删除|删掉|删去|删|取消|移除|去掉|放弃)|(?:把|将).{0,20}(?:删除|删掉|删去|删|取消|移除|去掉|放弃)|(?:删除|删掉|删去|删|取消|移除|去掉|放弃)(?:这个|该|掉|行程|活动|景点|站点|安排)|(?:please|may|can|allow|want\s+to)\s+(?:delete|remove|cancel)/iu;

export class AgentRunError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "AgentRunError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class AgentOperationValidationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "AgentOperationValidationError";
    this.code = code;
    this.details = details;
  }
}

function requireExactKeys(value, requiredKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentOperationValidationError(
      "INVALID_TOOL_ARGUMENTS",
      "Tool arguments must be a JSON object."
    );
  }
  const actual = Object.keys(value).sort();
  const expected = [...requiredKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new AgentOperationValidationError(
      "INVALID_TOOL_ARGUMENTS",
      "Tool arguments do not match the strict tool schema.",
      { requiredKeys: expected, actualKeys: actual }
    );
  }
}

function requireText(value, field, maxLength) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > maxLength
  ) {
    throw new AgentOperationValidationError(
      "INVALID_TOOL_ARGUMENTS",
      `${field} must be a non-empty string no longer than ${maxLength} characters.`
    );
  }
  return value.trim();
}

function minutesOf(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function removalIntent(instruction) {
  const text = String(instruction ?? "").replace(/\s+/g, " ").trim();
  const explicitlyForbidden = NEGATED_REMOVAL_PATTERN.test(text);
  return {
    explicitlyForbidden,
    explicitlyAuthorized: (
      !explicitlyForbidden &&
      AFFIRMATIVE_REMOVAL_PATTERN.test(text)
    )
  };
}

function providerTripSnapshot(trip) {
  return {
    tripId: trip.tripId,
    title: trip.title,
    city: trip.city,
    timezone: trip.timezone,
    status: trip.status,
    revisionId: trip.revisionId,
    revision: trip.revision,
    plannerState: structuredClone(trip.plannerState),
    stops: structuredClone(trip.stops)
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function operationSemanticArguments(operation) {
  if (operation.toolName === "move_stop") {
    return {
      client_stop_id: operation.arguments.client_stop_id,
      new_scheduled_time: operation.arguments.new_scheduled_time
    };
  }
  if (operation.toolName === "set_stop_lock") {
    return {
      client_stop_id: operation.arguments.client_stop_id,
      locked: operation.arguments.locked
    };
  }
  if (operation.toolName === "remove_stop") {
    return { client_stop_id: operation.arguments.client_stop_id };
  }
  if (operation.toolName === "finish_replan") return {};
  return operation.arguments;
}

function isEquivalentRejectedOperation(run, operation) {
  const fingerprint = `${operation.toolName}:${canonicalJson(
    operationSemanticArguments(operation)
  )}`;
  return run.operations.some((candidate) => (
    candidate.operationId !== operation.operationId &&
    candidate.status === "REJECTED" &&
    candidate.baseRevisionId === operation.baseRevisionId &&
    `${candidate.toolName}:${canonicalJson(
      operationSemanticArguments(candidate)
    )}` === fingerprint
  ));
}

function validateSchedule(stops) {
  if (!Array.isArray(stops) || stops.length < 1 || stops.length > 20) {
    throw new AgentOperationValidationError(
      "INVALID_AGENT_SCHEDULE",
      "An itinerary must contain between 1 and 20 stops."
    );
  }
  const ids = new Set();
  const ordered = [...stops].sort(
    (left, right) => minutesOf(left.scheduledTime) - minutesOf(right.scheduledTime)
  );
  for (const stop of ordered) {
    if (ids.has(stop.clientStopId)) {
      throw new AgentOperationValidationError(
        "INVALID_AGENT_SCHEDULE",
        "The Agent produced duplicate stop ids."
      );
    }
    ids.add(stop.clientStopId);
    if (!TIME_PATTERN.test(stop.scheduledTime)) {
      throw new AgentOperationValidationError(
        "INVALID_AGENT_SCHEDULE",
        "All Agent times must use HH:MM on 15-minute boundaries."
      );
    }
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (
      minutesOf(previous.scheduledTime) + previous.durationMinutes >
      minutesOf(current.scheduledTime)
    ) {
      throw new AgentOperationValidationError(
        "AGENT_SCHEDULE_OVERLAP",
        "The requested operation would create an overlapping itinerary.",
        {
          beforeClientStopId: previous.clientStopId,
          afterClientStopId: current.clientStopId
        }
      );
    }
  }
  return ordered;
}

function findStop(trip, clientStopId) {
  const stop = trip.stops.find((candidate) => candidate.clientStopId === clientStopId);
  if (!stop) {
    throw new AgentOperationValidationError(
      "STOP_NOT_FOUND",
      "The requested stop does not exist in the current trip.",
      { clientStopId }
    );
  }
  return stop;
}

function prepareOperation(
  toolName,
  operationArguments,
  trip,
  derivedConstraints,
  instruction
) {
  if (!ALLOWED_TOOLS.has(toolName)) {
    throw new AgentOperationValidationError(
      "UNSUPPORTED_AGENT_TOOL",
      "The model requested an unsupported tool.",
      { toolName }
    );
  }

  if (toolName === "finish_replan") {
    requireExactKeys(operationArguments, ["summary"]);
    const summary = requireText(operationArguments.summary, "summary", 1_000);
    const conflicts = findUnavailableWindowConflicts(
      trip.stops,
      derivedConstraints
    );
    if (conflicts.length > 0) {
      throw new AgentOperationValidationError(
        "REPLAN_CONSTRAINTS_UNSATISFIED",
        "The trip still contains stops inside a hard unavailable time window.",
        {
          offendingStops: conflicts,
          derivedConstraints
        }
      );
    }
    return {
      terminal: true,
      summary,
      output: { ok: true, summary }
    };
  }

  if (toolName === "move_stop") {
    requireExactKeys(operationArguments, [
      "client_stop_id",
      "new_scheduled_time",
      "reason"
    ]);
    const clientStopId = requireText(
      operationArguments.client_stop_id,
      "client_stop_id",
      120
    );
    const reason = requireText(operationArguments.reason, "reason", 500);
    if (
      typeof operationArguments.new_scheduled_time !== "string" ||
      !TIME_PATTERN.test(operationArguments.new_scheduled_time)
    ) {
      throw new AgentOperationValidationError(
        "INVALID_TOOL_ARGUMENTS",
        "new_scheduled_time must use HH:MM on a 15-minute boundary."
      );
    }
    const target = findStop(trip, clientStopId);
    if (operationArguments.new_scheduled_time === target.scheduledTime) {
      throw new AgentOperationValidationError(
        "NO_OP_OPERATION",
        "The requested move keeps the stop at its current time and would not change the trip.",
        {
          clientStopId,
          currentScheduledTime: target.scheduledTime,
          requestedScheduledTime: operationArguments.new_scheduled_time
        }
      );
    }
    if (target.locked) {
      throw new AgentOperationValidationError(
        "STOP_LOCKED",
        "A locked stop cannot be moved. Unlock it first.",
        { clientStopId }
      );
    }
    const before = target.scheduledTime;
    const candidateStops = trip.stops.map((stop) => (
      stop.clientStopId === clientStopId
        ? { ...stop, scheduledTime: operationArguments.new_scheduled_time }
        : { ...stop }
    ));
    const unavailableConflicts = findUnavailableWindowConflicts(
      candidateStops.filter((stop) => stop.clientStopId === clientStopId),
      derivedConstraints
    );
    if (unavailableConflicts.length > 0) {
      throw new AgentOperationValidationError(
        "UNAVAILABLE_WINDOW_CONFLICT",
        "The requested stop time overlaps a hard unavailable time window.",
        {
          offendingStops: unavailableConflicts,
          derivedConstraints
        }
      );
    }
    const stops = validateSchedule(candidateStops);
    return {
      terminal: false,
      stops,
      reason: `AGENT_MOVE_STOP_${clientStopId}`,
      output: {
        ok: true,
        toolName,
        clientStopId,
        before: { scheduledTime: before },
        after: { scheduledTime: operationArguments.new_scheduled_time },
        reason
      }
    };
  }

  if (toolName === "set_stop_lock") {
    requireExactKeys(operationArguments, ["client_stop_id", "locked", "reason"]);
    const clientStopId = requireText(
      operationArguments.client_stop_id,
      "client_stop_id",
      120
    );
    const reason = requireText(operationArguments.reason, "reason", 500);
    if (typeof operationArguments.locked !== "boolean") {
      throw new AgentOperationValidationError(
        "INVALID_TOOL_ARGUMENTS",
        "locked must be a boolean."
      );
    }
    const target = findStop(trip, clientStopId);
    if (operationArguments.locked === target.locked) {
      throw new AgentOperationValidationError(
        "NO_OP_OPERATION",
        "The requested lock state already matches the current stop and would not change the trip.",
        {
          clientStopId,
          currentLocked: target.locked,
          requestedLocked: operationArguments.locked
        }
      );
    }
    const stops = validateSchedule(trip.stops.map((stop) => (
      stop.clientStopId === clientStopId
        ? { ...stop, locked: operationArguments.locked }
        : { ...stop }
    )));
    return {
      terminal: false,
      stops,
      reason: `AGENT_SET_STOP_LOCK_${clientStopId}`,
      output: {
        ok: true,
        toolName,
        clientStopId,
        before: { locked: target.locked },
        after: { locked: operationArguments.locked },
        reason
      }
    };
  }

  requireExactKeys(operationArguments, ["client_stop_id", "reason"]);
  const clientStopId = requireText(
    operationArguments.client_stop_id,
    "client_stop_id",
    120
  );
  const reason = requireText(operationArguments.reason, "reason", 500);
  const target = findStop(trip, clientStopId);
  if (target.locked) {
    throw new AgentOperationValidationError(
      "STOP_LOCKED",
      "A locked stop cannot be removed. Unlock it first.",
      { clientStopId }
    );
  }
  if (trip.stops.length === 1) {
    throw new AgentOperationValidationError(
      "LAST_STOP_REQUIRED",
      "The final itinerary stop cannot be removed."
    );
  }
  const intent = removalIntent(instruction);
  const feasibility = findFeasibleTimesForStop(
    trip,
    target,
    derivedConstraints
  );
  const removalDetails = {
    clientStopId,
    currentScheduledTime: target.scheduledTime,
    durationMinutes: target.durationMinutes,
    suggestedTimes: feasibility.suggestedTimes,
    derivedConstraints
  };
  if (intent.explicitlyForbidden) {
    throw new AgentOperationValidationError(
      "REMOVAL_NOT_AUTHORIZED",
      "The user explicitly asked to preserve stops and did not authorize this removal.",
      removalDetails
    );
  }
  if (feasibility.hasFeasibleTime && !intent.explicitlyAuthorized) {
    throw new AgentOperationValidationError(
      "REMOVAL_NOT_REQUIRED",
      "A feasible non-overlapping time remains for this stop. Move it instead of removing it.",
      removalDetails
    );
  }
  const stops = validateSchedule(
    trip.stops.filter((stop) => stop.clientStopId !== clientStopId)
  );
  return {
    terminal: false,
    stops,
    reason: `AGENT_REMOVE_STOP_${clientStopId}`,
    output: {
      ok: true,
      toolName,
      clientStopId,
      before: {
        clientStopId: target.clientStopId,
        name: target.name,
        scheduledTime: target.scheduledTime
      },
      after: null,
      reason
    }
  };
}

export function createAgentManager({
  store,
  provider,
  logger = console,
  maxSteps = 24
}) {
  if (!store) throw new Error("Agent manager requires a store.");
  if (!provider) throw new Error("Agent manager requires a provider.");
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) {
    throw new Error("Agent maxSteps must be between 1 and 100.");
  }
  const inFlight = new Map();

  const processRun = async (runId) => {
    let run = store.getAgentRunInternal(runId);
    if (!run || TERMINAL_STATUSES.has(run.status) || run.status === "PAUSED") return run;
    const derivedConstraints = deriveAgentConstraints(run.instruction);
    const lastPersistedOperation = run.operations.at(-1);
    let lastToolResult = (
      run.providerResponseId &&
      lastPersistedOperation?.providerCallId &&
      ["APPLIED", "REJECTED"].includes(lastPersistedOperation.status) &&
      lastPersistedOperation.output
    )
      ? {
          providerCallId: lastPersistedOperation.providerCallId,
          output: lastPersistedOperation.output
        }
      : null;
    if (run.status === "QUEUED") {
      store.transitionAgentRun({
        runId,
        fromStatuses: ["QUEUED"],
        toStatus: "PLANNING",
        eventType: "run.planning"
      });
    }

    for (let step = 0; step < maxSteps; step += 1) {
      run = store.settleAgentBoundary(runId);
      if (!run || TERMINAL_STATUSES.has(run.status) || run.status === "PAUSED") return run;
      if (!run.providerResponseId) {
        // A rebase deliberately resets provider lineage. Never attach a
        // rejected operation from the discarded lineage to a new initial turn.
        lastToolResult = null;
      }

      let operation = store.getPendingAgentOperation(runId);
      if (!operation) {
        const trip = store.getTrip(run.tripId, run.ownerUserId);
        const planningHints = buildAgentPlanningHints(
          trip,
          derivedConstraints
        );
        const providerTurn = await provider.nextToolCall({
          run,
          trip,
          previousResponseId: (
            run.providerResponseId && lastToolResult
              ? run.providerResponseId
              : null
          ),
          toolResult: run.providerResponseId ? lastToolResult : null,
          conversationState: run.providerConversationState,
          derivedConstraints,
          planningHints
        });
        operation = store.recordAgentOperation({
          runId,
          providerCallId: providerTurn.call.providerCallId,
          toolName: providerTurn.call.toolName,
          arguments: providerTurn.call.arguments,
          providerResponseId: providerTurn.responseId,
          providerConversationState: providerTurn.conversationState
        });
        run = store.settleAgentBoundary(runId);
        if (!run || TERMINAL_STATUSES.has(run.status) || run.status === "PAUSED") return run;
      }

      const trip = store.getTrip(run.tripId, run.ownerUserId);
      let prepared;
      try {
        if (isEquivalentRejectedOperation(run, operation)) {
          throw new AgentOperationValidationError(
            "DUPLICATE_REJECTED_OPERATION",
            "This equivalent operation was already rejected. Do not retry it; choose a materially different valid action or finish the replan."
          );
        }
        prepared = prepareOperation(
          operation.toolName,
          operation.arguments,
          trip,
          derivedConstraints,
          run.instruction
        );
      } catch (error) {
        if (!(error instanceof AgentOperationValidationError)) throw error;
        const planningHints = buildAgentPlanningHints(
          trip,
          derivedConstraints
        );
        const details = (
          error.details !== null &&
          typeof error.details === "object" &&
          !Array.isArray(error.details)
        )
          ? { ...error.details, planningHints }
          : {
              ...(error.details === undefined
                ? {}
                : { originalDetails: error.details }),
              planningHints
            };
        const rejection = {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            details
          },
          revisionId: trip.revisionId,
          revision: trip.revision,
          derivedConstraints,
          planningHints,
          trip: providerTripSnapshot(trip)
        };
        const rejectedOperation = store.rejectAgentOperation(
          runId,
          operation.operationId,
          rejection.error,
          rejection
        );
        lastToolResult = {
          providerCallId: operation.providerCallId,
          output: rejectedOperation?.output ?? rejection
        };
        continue;
      }

      if (prepared.terminal) {
        const plannerState = mergeDerivedConstraintsIntoPlannerState(
          trip.plannerState,
          derivedConstraints
        );
        const planningHints = buildAgentPlanningHints(
          trip,
          derivedConstraints
        );
        return store.completeAgentRun(
          runId,
          operation.operationId,
          prepared.summary,
          { ...prepared.output, planningHints },
          { plannerState, derivedConstraints }
        );
      }

      const plannerState = mergeDerivedConstraintsIntoPlannerState(
        trip.plannerState,
        derivedConstraints
      );
      const planningHints = buildAgentPlanningHints(
        { ...trip, stops: prepared.stops },
        derivedConstraints
      );
      const result = store.applyAgentOperation({
        runId,
        operationId: operation.operationId,
        stops: prepared.stops,
        output: { ...prepared.output, planningHints },
        reason: prepared.reason,
        plannerState,
        derivedConstraints
      });
      if (result?.conflicted) return result.run;
      lastToolResult = {
        providerCallId: operation.providerCallId,
        output: result.operation.output
      };
    }

    return store.failAgentRun(
      runId,
      "AGENT_STEP_LIMIT_EXCEEDED",
      `The Agent exceeded the configured ${maxSteps}-step limit.`
    );
  };

  const enqueue = (runId) => {
    if (inFlight.has(runId)) return inFlight.get(runId);
    const task = new Promise((resolve) => setImmediate(resolve))
      .then(() => processRun(runId))
      .catch((error) => {
        const code = error instanceof AgentProviderError
          ? error.code
          : "AGENT_EXECUTION_FAILED";
        const message = error instanceof AgentProviderError
          ? error.message
          : "The Agent run failed while executing a validated operation.";
        logger.error?.({
          event: "agent_run_failed",
          runId,
          code,
          errorName: error?.name
        });
        return store.failAgentRun(runId, code, message);
      })
      .finally(() => inFlight.delete(runId));
    inFlight.set(runId, task);
    return task;
  };

  return {
    providerName: provider.providerName,
    modelName: provider.modelName,
    isAvailable() {
      return provider.available !== false;
    },
    unavailableReason() {
      return provider.unavailableReason ?? null;
    },
    startRun({
      tripId,
      ownerUserId,
      baseRevisionId,
      instruction
    }) {
      if (provider.available === false) {
        throw new AgentRunError(
          503,
          "AGENT_PROVIDER_UNAVAILABLE",
          provider.unavailableReason ?? "The Agent provider is unavailable."
        );
      }
      const initialTrip = store.getTrip(tripId, ownerUserId);
      if (initialTrip?.revisionId === baseRevisionId) {
        const derivedConstraints = deriveAgentConstraints(instruction);
        const lockedConflicts = findUnavailableWindowConflicts(
          initialTrip.stops.filter((stop) => stop.locked),
          derivedConstraints
        );
        if (lockedConflicts.length > 0) {
          throw new AgentRunError(
            409,
            "LOCKED_STOP_CONSTRAINT_CONFLICT",
            "A locked stop conflicts with an unavailable time window. Unlock or revise it before starting the Agent.",
            [{
              offendingStops: lockedConflicts,
              derivedConstraints,
              trip: providerTripSnapshot(initialTrip)
            }]
          );
        }
      }
      const created = store.createQueuedAgentRun({
        runId: `agent-run-${randomUUID()}`,
        tripId,
        ownerUserId,
        baseRevisionId,
        instruction,
        provider: provider.providerName,
        model: provider.modelName
      });
      if (!created) {
        throw new AgentRunError(404, "TRIP_NOT_FOUND", "Trip not found.");
      }
      if (created.activeRun) {
        throw new AgentRunError(
          409,
          "AGENT_RUN_ALREADY_ACTIVE",
          "This trip already has an active Agent run.",
          [{
            runId: created.activeRun.runId,
            status: created.activeRun.status
          }]
        );
      }
      enqueue(created.run.runId);
      return created.run;
    },
    command(runId, ownerUserId, command, options = {}) {
      const result = store.requestAgentCommand(runId, ownerUserId, command, options);
      if (!result) {
        throw new AgentRunError(404, "AGENT_RUN_NOT_FOUND", "Agent run not found.");
      }
      if (!result.accepted) {
        throw new AgentRunError(
          409,
          result.code,
          `The ${command} command is not valid while the run is ${result.run.status}.`,
          [{ status: result.run.status }]
        );
      }
      if (command === "resume" && result.run.status === "RESUMING") enqueue(runId);
      return result.run;
    },
    undo(runId, ownerUserId, expectedRevisionId) {
      const result = store.undoAgentRun(runId, ownerUserId, expectedRevisionId);
      if (!result) {
        throw new AgentRunError(404, "AGENT_RUN_NOT_FOUND", "Agent run not found.");
      }
      if (!result.accepted) {
        throw new AgentRunError(
          409,
          result.code,
          "The Agent run cannot be undone against the current trip revision.",
          [{
            status: result.run.status,
            currentRevisionId: result.trip?.revisionId ?? null
          }]
        );
      }
      return result;
    },
    recover() {
      for (const run of store.listRecoverableAgentRuns()) {
        if (
          provider.supportsRecovery === true &&
          ["QUEUED", "PLANNING", "RUNNING", "RESUMING"].includes(run.status)
        ) {
          enqueue(run.runId);
        } else if (run.status === "PAUSE_REQUESTED" || run.status === "STOP_REQUESTED") {
          store.settleAgentBoundary(run.runId);
        } else {
          store.failAgentRun(
            run.runId,
            "AGENT_PROCESS_RESTARTED",
            "The service restarted while this Agent run was in progress."
          );
        }
      }
    },
    waitForIdle(runId) {
      return inFlight.get(runId) ?? Promise.resolve(store.getAgentRunInternal(runId));
    }
  };
}
