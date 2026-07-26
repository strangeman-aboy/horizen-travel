const PHASE_BY_SERVER_STATUS = Object.freeze({
  ACCEPTED: "starting",
  QUEUED: "starting",
  PLANNING: "planning",
  RUNNING: "running",
  PAUSE_REQUESTED: "pausing",
  PAUSED: "paused",
  RESUME_REQUESTED: "resuming",
  RESUMING: "resuming",
  STOP_REQUESTED: "stopping",
  CANCEL_REQUESTED: "stopping",
  STOPPED: "stopped",
  CANCELLED: "stopped",
  COMPLETED: "completed",
  FAILED: "failed",
  CONFLICTED: "conflicted",
  REBASE_REQUIRED: "conflicted",
  UNDOING: "undoing",
  UNDONE: "idle",
});

export const AGENT_RUN_PHASES = Object.freeze([
  "idle",
  "starting",
  "planning",
  "running",
  "pausing",
  "paused",
  "resuming",
  "stopping",
  "stopped",
  "completed",
  "failed",
  "conflicted",
  "reconnecting",
  "undoing",
]);

export const AGENT_RUN_CONNECTION_STATES = Object.freeze([
  "idle",
  "connecting",
  "connected",
  "reconnecting",
  "closed",
]);

const TERMINAL_PHASES = new Set(["idle", "stopped", "completed", "failed", "conflicted"]);
const ACTIVE_PHASES = new Set([
  "starting",
  "planning",
  "running",
  "pausing",
  "paused",
  "resuming",
  "stopping",
  "reconnecting",
  "undoing",
]);

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function unwrapPayload(value) {
  const candidate = asObject(value);
  const data = asObject(candidate.data);
  const nestedRun = asObject(firstDefined(data.run, candidate.run));
  if (nestedRun.runId || nestedRun.id) return nestedRun;
  if (data.runId || data.id) return data;
  return candidate;
}

function normalizeToken(value, fallback = "") {
  const token = String(value ?? "").trim();
  return token ? token.toUpperCase().replaceAll("-", "_").replaceAll(".", "_") : fallback;
}

function normalizeSequence(value, fallback = null) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function normalizeRevision(value) {
  const revision = String(value ?? "").trim();
  return revision || null;
}

function normalizeMessage(value, {
  sequence = null,
  at = null,
  fallbackRole = "agent",
  fallbackId = null,
} = {}) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    return {
      id: fallbackId ?? `message-${sequence ?? "local"}-${text.slice(0, 24)}`,
      role: fallbackRole,
      text,
      sequence,
      at,
    };
  }

  const raw = asObject(value);
  const text = String(firstDefined(raw.text, raw.message, raw.content, "")).trim();
  if (!text) return null;
  return {
    id: String(firstDefined(raw.messageId, raw.id, fallbackId, `message-${sequence ?? "local"}`)),
    role: String(firstDefined(raw.role, fallbackRole)).toLowerCase(),
    text,
    sequence: normalizeSequence(firstDefined(raw.sequence, raw.seq), sequence),
    at: firstDefined(raw.at, raw.createdAt, at, null),
  };
}

function appendMessage(messages, message) {
  if (!message) return messages;
  if (messages.some((item) => item.id === message.id)) return messages;
  return [...messages, message];
}

export function normalizeAgentRunError(error, fallbackCode = "AGENT_RUN_FAILED") {
  if (!error) return null;
  const raw = asObject(error);
  const nested = asObject(raw.error);
  return {
    code: String(firstDefined(raw.code, nested.code, fallbackCode)),
    message: String(firstDefined(raw.message, nested.message, "Agent Run 请求失败。")),
    status: Number(firstDefined(raw.status, nested.status, 0)) || 0,
    requestId: firstDefined(raw.requestId, nested.requestId, null),
    details: firstDefined(raw.details, nested.details, null),
    retryable: Boolean(firstDefined(raw.retryable, nested.retryable, false)),
  };
}

export function phaseFromAgentRunStatus(status, fallback = "idle") {
  return PHASE_BY_SERVER_STATUS[normalizeToken(status)] ?? fallback;
}

export function normalizeAgentRun(value) {
  const raw = unwrapPayload(value);
  const status = normalizeToken(firstDefined(raw.status, raw.phase), "PLANNING");
  return {
    runId: firstDefined(raw.runId, raw.id, null),
    tripId: firstDefined(raw.tripId, null),
    status,
    phase: phaseFromAgentRunStatus(status, "planning"),
    instruction: String(firstDefined(raw.instruction, raw.prompt, "")).trim(),
    runVersion: normalizeSequence(firstDefined(raw.runVersion, raw.version), 0),
    baseRevisionId: normalizeRevision(firstDefined(
      raw.baseRevisionId,
      raw.baseRevision,
    )),
    headRevisionId: normalizeRevision(firstDefined(
      raw.headRevisionId,
      raw.headRevision,
      raw.resultRevisionId,
      raw.revisionId,
    )),
    eventCursor: normalizeSequence(firstDefined(
      raw.eventCursor,
      raw.lastSequence,
      raw.sequence,
    ), 0),
    operations: Array.isArray(raw.operations) ? raw.operations : [],
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    error: raw.error ? normalizeAgentRunError(raw.error) : null,
    raw,
  };
}

export function normalizeAgentOperation(value, {
  sequence = null,
  eventType = "",
  headRevisionId = null,
} = {}) {
  const raw = asObject(value);
  const args = asObject(raw.arguments);
  const type = String(firstDefined(raw.type, raw.operationType, raw.toolName, "operation.unknown"));
  const eventStatus = (
    eventType.endsWith(".started")
    || eventType.endsWith(".pending")
  )
    ? "STARTED"
    : eventType.endsWith(".applied")
      ? "APPLIED"
      : (
          eventType.endsWith(".failed")
          || eventType.endsWith(".rejected")
        )
        ? "FAILED"
        : null;
  const inferredAfter = type === "move_stop" && args.new_scheduled_time
    ? { scheduledTime: args.new_scheduled_time }
    : type === "set_stop_lock" && typeof args.locked === "boolean"
      ? { locked: args.locked }
      : null;
  const normalizedSequence = normalizeSequence(
    firstDefined(raw.sequence, raw.seq),
    sequence,
  );
  return {
    operationId: String(firstDefined(
      raw.operationId,
      raw.id,
      raw.toolCallId,
      `operation-${normalizedSequence ?? "unknown"}`,
    )),
    type,
    status: normalizeToken(firstDefined(raw.status, eventStatus), "PLANNED"),
    targetClientStopId: firstDefined(
      raw.targetClientStopId,
      raw.clientStopId,
      raw.targetStopId,
      asObject(raw.target).clientStopId,
      args.client_stop_id,
      args.clientStopId,
      null,
    ),
    before: firstDefined(raw.before, null),
    after: firstDefined(raw.after, raw.result, inferredAfter, null),
    reason: String(firstDefined(raw.reason, raw.explanation, args.reason, "")).trim(),
    title: String(firstDefined(raw.title, raw.label, type)).trim(),
    detail: String(firstDefined(
      raw.detail,
      raw.description,
      raw.reason,
      args.reason,
      "",
    )).trim(),
    sequence: normalizedSequence,
    resultRevisionId: normalizeRevision(firstDefined(
      raw.resultRevisionId,
      raw.headRevisionId,
      raw.headRevision,
      headRevisionId,
    )),
    raw,
  };
}

export function normalizeAgentRunEvent(value) {
  const raw = asObject(value);
  const payload = asObject(raw.payload);
  const sequence = normalizeSequence(firstDefined(raw.sequence, raw.seq), null);
  const type = String(firstDefined(raw.type, raw.eventType, "")).trim().toLowerCase();
  const headRevisionId = normalizeRevision(firstDefined(
    raw.headRevisionId,
    raw.headRevision,
    payload.headRevisionId,
    payload.headRevision,
    payload.resultRevisionId,
    payload.revisionId,
  ));
  const operationSource = firstDefined(payload.operation, raw.operation, (
    type.startsWith("operation.") ? payload : null
  ));
  const messageSource = firstDefined(payload.message, payload.text, raw.message, null);
  return {
    eventId: String(firstDefined(raw.eventId, raw.id, `${raw.runId ?? "run"}:${sequence ?? "unknown"}`)),
    runId: firstDefined(raw.runId, payload.runId, null),
    sequence,
    type,
    at: firstDefined(raw.at, raw.occurredAt, raw.createdAt, null),
    runVersion: normalizeSequence(firstDefined(raw.runVersion, payload.runVersion), null),
    baseRevisionId: normalizeRevision(firstDefined(
      raw.baseRevisionId,
      raw.baseRevision,
      payload.baseRevisionId,
      payload.baseRevision,
    )),
    headRevisionId,
    status: normalizeToken(firstDefined(raw.status, payload.status), ""),
    operation: operationSource
      ? normalizeAgentOperation(operationSource, {
          sequence,
          eventType: type,
          headRevisionId,
        })
      : null,
    message: normalizeMessage(messageSource, {
      sequence,
      at: firstDefined(raw.at, raw.occurredAt, null),
      fallbackRole: String(firstDefined(payload.role, "agent")).toLowerCase(),
      fallbackId: `${raw.runId ?? "run"}:message:${sequence ?? "unknown"}`,
    }),
    payload,
    raw,
  };
}

export function normalizeAgentRunEventPage(value) {
  const raw = asObject(value);
  const data = asObject(raw.data);
  const source = Object.keys(data).length ? data : raw;
  const eventValues = Array.isArray(source.events)
    ? source.events
    : Array.isArray(source.items)
      ? source.items
      : Array.isArray(value)
        ? value
        : [];
  const events = eventValues
    .map(normalizeAgentRunEvent)
    .filter((event) => event.sequence !== null)
    .sort((left, right) => left.sequence - right.sequence);
  const lastEventSequence = events.at(-1)?.sequence ?? 0;
  return {
    events,
    nextSequence: normalizeSequence(firstDefined(
      source.nextSequence,
      source.eventCursor,
      source.lastSequence,
    ), lastEventSequence),
    hasMore: Boolean(source.hasMore),
    run: source.run ? normalizeAgentRun(source.run) : null,
    raw,
  };
}

export function createInitialAgentRunState(overrides = {}) {
  return {
    phase: "idle",
    phaseBeforeReconnect: null,
    status: "IDLE",
    connection: "idle",
    instruction: "",
    tripId: null,
    runId: null,
    runVersion: 0,
    baseRevisionId: null,
    headRevisionId: null,
    lastSequence: 0,
    eventCursor: 0,
    operations: [],
    previewOperation: null,
    changedStopIds: [],
    messages: [],
    pendingCommand: null,
    conflict: null,
    error: null,
    undoApplied: false,
    run: null,
    ...overrides,
  };
}

export const initialAgentRunState = Object.freeze(createInitialAgentRunState());

function upsertOperation(operations, operation) {
  const index = operations.findIndex((item) => item.operationId === operation.operationId);
  if (index < 0) return [...operations, operation];
  const next = operations.slice();
  next[index] = {
    ...operations[index],
    ...operation,
    before: operation.before ?? operations[index].before,
    after: operation.after ?? operations[index].after,
  };
  return next;
}

function commandSatisfied(command, status) {
  const normalizedStatus = normalizeToken(status);
  if (command === "PAUSE") return normalizedStatus === "PAUSED";
  if (command === "RESUME") return normalizedStatus === "RUNNING";
  if (command === "STOP") return ["STOPPED", "CANCELLED"].includes(normalizedStatus);
  if (command === "UNDO") return normalizedStatus === "UNDONE";
  return false;
}

function applyRunStatus(state, status, fallbackPhase = state.phase) {
  const normalizedStatus = normalizeToken(status, state.status);
  const phase = phaseFromAgentRunStatus(normalizedStatus, fallbackPhase);
  const pendingCommand = commandSatisfied(state.pendingCommand?.command, normalizedStatus)
    ? null
    : state.pendingCommand;
  return {
    ...state,
    status: normalizedStatus,
    phase,
    pendingCommand,
  };
}

function applyNormalizedRun(state, run) {
  const withStatus = applyRunStatus(state, run.status, run.phase);
  let messages = withStatus.messages;
  run.messages.forEach((message, index) => {
    messages = appendMessage(messages, normalizeMessage(message, {
      fallbackId: `${run.runId ?? "run"}:server-message:${index}`,
    }));
  });
  let operations = withStatus.operations;
  run.operations.forEach((operation, index) => {
    operations = upsertOperation(operations, normalizeAgentOperation(operation, {
      sequence: index,
      headRevisionId: run.headRevisionId,
    }));
  });
  return {
    ...withStatus,
    tripId: run.tripId ?? withStatus.tripId,
    runId: run.runId ?? withStatus.runId,
    instruction: run.instruction || withStatus.instruction,
    runVersion: Math.max(withStatus.runVersion ?? 0, run.runVersion ?? 0),
    baseRevisionId: run.baseRevisionId ?? withStatus.baseRevisionId,
    headRevisionId: run.headRevisionId ?? withStatus.headRevisionId,
    eventCursor: Math.max(withStatus.eventCursor, run.eventCursor ?? 0),
    operations,
    messages,
    error: run.error ?? withStatus.error,
    run,
  };
}

function applyEvent(state, event) {
  let next = {
    ...state,
    runId: event.runId ?? state.runId,
    runVersion: event.runVersion ?? state.runVersion,
    baseRevisionId: event.baseRevisionId ?? state.baseRevisionId,
    headRevisionId: event.headRevisionId ?? state.headRevisionId,
    lastSequence: event.sequence,
    eventCursor: event.sequence,
    messages: appendMessage(state.messages, event.message),
    error: null,
  };

  if (event.type === "run.status") {
    return applyRunStatus(next, event.status || event.payload.status, next.phase);
  }

  if (event.type === "plan.created") {
    const plannedOperations = Array.isArray(event.payload.operations)
      ? event.payload.operations
      : [];
    let operations = next.operations;
    plannedOperations.forEach((operation) => {
      operations = upsertOperation(operations, normalizeAgentOperation(operation, {
        sequence: event.sequence,
        headRevisionId: event.headRevisionId,
      }));
    });
    return {
      ...next,
      phase: next.phase === "planning" ? "planning" : "running",
      status: next.status === "PLANNING" ? "PLANNING" : "RUNNING",
      operations,
    };
  }

  if (
    ["operation.started", "operation.pending"].includes(event.type)
    && event.operation
  ) {
    const operation = { ...event.operation, status: "STARTED" };
    return {
      ...next,
      phase: "running",
      status: "RUNNING",
      operations: upsertOperation(next.operations, operation),
      previewOperation: operation,
    };
  }

  if (event.type === "operation.applied" && event.operation) {
    const operation = { ...event.operation, status: "APPLIED" };
    const targetId = operation.targetClientStopId;
    return {
      ...next,
      phase: next.phase === "pausing" ? "pausing" : "running",
      operations: upsertOperation(next.operations, operation),
      previewOperation: next.previewOperation?.operationId === operation.operationId
        ? null
        : next.previewOperation,
      changedStopIds: targetId === null || targetId === undefined
        ? next.changedStopIds
        : [...new Set([...next.changedStopIds.map(String), String(targetId)])],
      headRevisionId: operation.resultRevisionId ?? next.headRevisionId,
    };
  }

  if (
    ["operation.failed", "operation.rejected"].includes(event.type)
    && event.operation
  ) {
    const operation = { ...event.operation, status: "FAILED" };
    return {
      ...next,
      operations: upsertOperation(next.operations, operation),
      previewOperation: next.previewOperation?.operationId === operation.operationId
        ? null
        : next.previewOperation,
      error: normalizeAgentRunError(
        event.payload.error ?? { message: operation.reason || "Agent 操作失败。" },
        "AGENT_OPERATION_FAILED",
      ),
    };
  }

  if (event.type === "run.rebase_required") {
    return {
      ...next,
      phase: "conflicted",
      status: "REBASE_REQUIRED",
      pendingCommand: null,
      previewOperation: null,
      conflict: {
        code: "REVISION_CONFLICT",
        currentRevisionId: normalizeRevision(firstDefined(
          event.payload.currentRevisionId,
          event.payload.currentRevision,
          event.headRevisionId,
        )),
        currentSnapshot: firstDefined(event.payload.currentSnapshot, null),
        event,
      },
    };
  }

  if (event.type === "run.completed") {
    return {
      ...applyRunStatus(next, "COMPLETED", "completed"),
      previewOperation: null,
    };
  }

  if (event.type === "run.failed") {
    return {
      ...applyRunStatus(next, "FAILED", "failed"),
      previewOperation: null,
      error: normalizeAgentRunError(
        event.payload.error ?? { message: event.payload.message ?? "Agent Run 失败。" },
      ),
    };
  }

  if (event.type === "run.cancelled" || event.type === "run.stopped") {
    return {
      ...applyRunStatus(next, event.type === "run.cancelled" ? "CANCELLED" : "STOPPED", "stopped"),
      previewOperation: null,
    };
  }

  if (event.type === "undo.applied") {
    return {
      ...applyRunStatus(next, "UNDONE", "idle"),
      previewOperation: null,
      operations: next.operations.map((operation) => (
        operation.status === "APPLIED" ? { ...operation, status: "UNDONE" } : operation
      )),
      changedStopIds: [],
      undoApplied: true,
      pendingCommand: null,
    };
  }

  if (event.type.startsWith("run.") && event.status) {
    return applyRunStatus(next, event.status, next.phase);
  }

  return next;
}

export function ingestAgentRunEvents(state, values) {
  const normalized = (Array.isArray(values) ? values : [values])
    .map((value) => normalizeAgentRunEvent(value))
    .filter((event) => event.sequence !== null && event.sequence > state.lastSequence)
    .sort((left, right) => left.sequence - right.sequence);
  const acceptedEvents = [];
  const seenSequences = new Set();
  let next = state;

  normalized.forEach((event) => {
    if (seenSequences.has(event.sequence) || event.sequence <= next.lastSequence) return;
    seenSequences.add(event.sequence);
    acceptedEvents.push(event);
    next = applyEvent(next, event);
  });

  return { state: next, acceptedEvents };
}

export function agentRunReducer(state, action) {
  switch (action.type) {
    case "RESET":
      return createInitialAgentRunState(action.overrides);
    case "REPLACE":
      return action.state;
    case "START_REQUESTED": {
      const instruction = String(action.instruction ?? "").trim();
      const message = normalizeMessage(instruction, {
        fallbackRole: "user",
        fallbackId: `local:user:${action.requestId ?? Date.now()}`,
      });
      return createInitialAgentRunState({
        phase: "starting",
        status: "STARTING",
        connection: "connecting",
        instruction,
        tripId: action.tripId ?? null,
        baseRevisionId: action.baseRevisionId ?? null,
        headRevisionId: action.baseRevisionId ?? null,
        messages: message ? [message] : [],
      });
    }
    case "RUN_ACCEPTED":
      return applyNormalizedRun(state, normalizeAgentRun(action.run));
    case "EVENTS_RECEIVED":
      return ingestAgentRunEvents(state, action.events).state;
    case "CONNECTION_CHANGED": {
      const connection = action.connection;
      if (!AGENT_RUN_CONNECTION_STATES.includes(connection)) return state;
      if (connection === "reconnecting" && ACTIVE_PHASES.has(state.phase)) {
        return {
          ...state,
          connection,
          phaseBeforeReconnect: state.phase === "reconnecting"
            ? state.phaseBeforeReconnect
            : state.phase,
          phase: "reconnecting",
        };
      }
      if (connection === "connected" && state.phase === "reconnecting") {
        return {
          ...state,
          connection,
          phase: state.phaseBeforeReconnect ?? "running",
          phaseBeforeReconnect: null,
        };
      }
      return { ...state, connection };
    }
    case "COMMAND_REQUESTED": {
      const command = normalizeToken(action.command);
      const phase = command === "PAUSE"
        ? "pausing"
        : command === "RESUME"
          ? "resuming"
          : command === "STOP"
            ? "stopping"
            : state.phase;
      return {
        ...state,
        phase,
        pendingCommand: {
          command,
          requestedAt: action.requestedAt ?? new Date().toISOString(),
          baseRevisionId: action.baseRevisionId ?? null,
          previousPhase: state.phase,
          acknowledged: false,
        },
        error: null,
      };
    }
    case "COMMAND_ACKNOWLEDGED": {
      const run = normalizeAgentRun(action.run);
      const next = applyNormalizedRun(state, run);
      return {
        ...next,
        pendingCommand: next.pendingCommand
          ? { ...next.pendingCommand, acknowledged: true }
          : null,
      };
    }
    case "COMMAND_FAILED": {
      const error = normalizeAgentRunError(action.error);
      if (error.status === 409 || error.code === "REVISION_CONFLICT") {
        return {
          ...state,
          phase: "conflicted",
          status: "REBASE_REQUIRED",
          pendingCommand: null,
          conflict: {
            code: error.code,
            currentRevisionId: normalizeRevision(firstDefined(
              asObject(Array.isArray(error.details) ? error.details[0] : error.details).currentRevisionId,
              asObject(error.details).currentRevision,
            )),
            currentSnapshot: asObject(error.details).currentSnapshot ?? null,
            error,
          },
          error,
        };
      }
      return {
        ...state,
        phase: state.pendingCommand?.previousPhase ?? state.phase,
        pendingCommand: null,
        error,
      };
    }
    case "UNDO_REQUESTED":
      return {
        ...state,
        phase: "undoing",
        pendingCommand: {
          command: "UNDO",
          requestedAt: action.requestedAt ?? new Date().toISOString(),
          previousPhase: state.phase,
          acknowledged: false,
        },
        error: null,
      };
    case "UNDO_ACKNOWLEDGED": {
      const run = normalizeAgentRun(action.run);
      const next = applyNormalizedRun(state, run);
      const isUndone = next.status === "UNDONE";
      return {
        ...next,
        pendingCommand: isUndone
          ? null
          : { ...state.pendingCommand, acknowledged: true },
        previewOperation: isUndone ? null : next.previewOperation,
        operations: isUndone
          ? next.operations.map((operation) => (
              operation.status === "APPLIED"
                ? { ...operation, status: "UNDONE" }
                : operation
            ))
          : next.operations,
        changedStopIds: isUndone ? [] : next.changedStopIds,
        undoApplied: isUndone || next.undoApplied,
      };
    }
    case "FAILURE": {
      const error = normalizeAgentRunError(action.error);
      if (error.status === 409 || error.code === "REVISION_CONFLICT") {
        return agentRunReducer(state, { type: "COMMAND_FAILED", error });
      }
      return {
        ...state,
        phase: "failed",
        status: "FAILED",
        pendingCommand: null,
        previewOperation: null,
        error,
      };
    }
    default:
      return state;
  }
}

export function isTerminalAgentRunPhase(phase) {
  return TERMINAL_PHASES.has(phase);
}

export function isActiveAgentRunPhase(phase) {
  return ACTIVE_PHASES.has(phase);
}
