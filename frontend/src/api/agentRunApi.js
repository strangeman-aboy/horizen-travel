import {
  ApiRequestError,
  createIdempotencyKey,
  travelApi,
} from "./travelApi.js";
import {
  isTerminalAgentRunPhase,
  normalizeAgentRun,
  normalizeAgentRunEventPage,
} from "../agent/agentRunReducer.js";

const AGENT_COMMANDS = new Set(["PAUSE", "RESUME", "STOP"]);

function requireIdentifier(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new ApiRequestError(`${fieldName} 不能为空。`, {
      code: "INVALID_REQUEST_ARGUMENT",
      details: { field: fieldName },
    });
  }
  return normalized;
}

function requireRevision(value, fieldName = "baseRevisionId") {
  const revision = requireIdentifier(value, fieldName);
  if (/[\u0000-\u001f"]/u.test(revision)) {
    throw new ApiRequestError(`${fieldName} 不是有效的行程版本。`, {
      code: "INVALID_REQUEST_ARGUMENT",
      details: { field: fieldName },
    });
  }
  return revision;
}

function requireInstruction(value) {
  const instruction = String(value ?? "").trim();
  if (!instruction) {
    throw new ApiRequestError("instruction 不能为空。", {
      code: "INVALID_REQUEST_ARGUMENT",
      details: { field: "instruction" },
    });
  }
  if (instruction.length > 2_000) {
    throw new ApiRequestError("instruction 不能超过 2000 个字符。", {
      code: "INVALID_REQUEST_ARGUMENT",
      details: { field: "instruction", maxLength: 2_000 },
    });
  }
  return instruction;
}

function encodeSegment(value, fieldName) {
  return encodeURIComponent(requireIdentifier(value, fieldName));
}

function quoteRevision(revision) {
  return `"${requireRevision(revision)}"`;
}

function normalizeCommand(value) {
  const command = String(value ?? "").trim().toUpperCase();
  if (!AGENT_COMMANDS.has(command)) {
    throw new ApiRequestError("command 必须是 PAUSE、RESUME 或 STOP。", {
      code: "INVALID_REQUEST_ARGUMENT",
      details: { field: "command", allowed: [...AGENT_COMMANDS] },
    });
  }
  return command;
}

function normalizeLimit(value, fallback = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(1, Math.trunc(number)));
}

function normalizeSequence(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function isAbortError(error, signal) {
  return Boolean(
    signal?.aborted
    || error?.code === "API_REQUEST_ABORTED"
    || error?.name === "AbortError",
  );
}

function isRetryableSubscriptionError(error) {
  if (error?.status === 409 || error?.code === "REVISION_CONFLICT") return false;
  if (error?.retryable) return true;
  return !error?.status || error.status === 408 || error.status === 429 || error.status >= 500;
}

function waitWithSignal(delayMs, signal) {
  if (!delayMs) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function terminalRun(run) {
  return Boolean(run && isTerminalAgentRunPhase(run.phase) && run.phase !== "idle");
}

export function createAgentRunApi({
  api = travelApi,
  pollIntervalMs = 350,
  maxReconnectDelayMs = 5_000,
} = {}) {
  if (!api || typeof api.request !== "function") {
    throw new TypeError("createAgentRunApi requires an API client with request(path, options).");
  }

  const runPath = (tripId, runId = null) => {
    const base = `/trips/${encodeSegment(tripId, "tripId")}/agent-runs`;
    return runId === null ? base : `${base}/${encodeSegment(runId, "runId")}`;
  };

  async function startRun({
    tripId,
    instruction,
    baseRevisionId,
    idempotencyKey = createIdempotencyKey("agent-run-start"),
    signal,
  }) {
    const revision = requireRevision(baseRevisionId);
    const payload = await api.request(runPath(tripId), {
      method: "POST",
      headers: { "If-Match": quoteRevision(revision) },
      body: {
        instruction: requireInstruction(instruction),
        baseRevisionId: revision,
      },
      idempotencyKey,
      signal,
    });
    return normalizeAgentRun(payload);
  }

  async function getRun({ tripId, runId, signal }) {
    const payload = await api.request(runPath(tripId, runId), { signal });
    return normalizeAgentRun(payload);
  }

  async function listRunEvents({
    tripId,
    runId,
    afterSequence = 0,
    limit = 100,
    signal,
  }) {
    const query = new URLSearchParams({
      after: String(normalizeSequence(afterSequence)),
      limit: String(normalizeLimit(limit)),
    });
    const payload = await api.request(`${runPath(tripId, runId)}/events?${query}`, { signal });
    return normalizeAgentRunEventPage(payload);
  }

  async function sendCommand({
    tripId,
    runId,
    command,
    baseRevisionId = null,
    idempotencyKey = createIdempotencyKey("agent-run-command"),
    signal,
  }) {
    const normalizedCommand = normalizeCommand(command);
    const revision = baseRevisionId === null || baseRevisionId === undefined
      ? null
      : requireRevision(baseRevisionId);
    if (normalizedCommand === "RESUME" && !revision) {
      throw new ApiRequestError("RESUME 需要最新的 baseRevisionId。", {
        code: "MISSING_REVISION_ID",
        details: { field: "baseRevisionId" },
      });
    }
    const payload = await api.request(`${runPath(tripId, runId)}/commands`, {
      method: "POST",
      body: {
        command: normalizedCommand,
        ...(revision ? { baseRevisionId: revision } : {}),
      },
      idempotencyKey,
      signal,
    });
    return normalizeAgentRun(payload);
  }

  const pauseRun = (input) => sendCommand({ ...input, command: "PAUSE" });
  const resumeRun = (input) => sendCommand({ ...input, command: "RESUME" });
  const stopRun = (input) => sendCommand({ ...input, command: "STOP" });

  async function undoRun({
    tripId,
    runId,
    expectedRevisionId,
    idempotencyKey = createIdempotencyKey("agent-run-undo"),
    signal,
  }) {
    const revision = requireRevision(expectedRevisionId, "expectedRevisionId");
    const payload = await api.request(`${runPath(tripId, runId)}/undo`, {
      method: "POST",
      headers: { "If-Match": quoteRevision(revision) },
      body: {},
      idempotencyKey,
      signal,
    });
    if (!(payload?.runId || payload?.status || payload?.data || payload?.run)) {
      return payload;
    }
    return {
      ...normalizeAgentRun(payload),
      committedTrip: payload?.trip ?? payload?.data?.trip ?? null,
    };
  }

  async function subscribeRunEvents({
    tripId,
    runId,
    afterSequence = 0,
    limit = 100,
    signal,
    onEvent,
    onConnectionChange,
    shouldStop,
  }) {
    let cursor = normalizeSequence(afterSequence);
    let reconnectAttempt = 0;
    let connection = null;
    const setConnection = (next, details = null) => {
      if (connection === next && !details) return;
      connection = next;
      onConnectionChange?.(next, details);
    };

    setConnection("connecting");
    try {
      while (!signal?.aborted && !shouldStop?.()) {
        try {
          const page = await listRunEvents({
            tripId,
            runId,
            afterSequence: cursor,
            limit,
            signal,
          });
          setConnection("connected");
          reconnectAttempt = 0;

          const unseen = page.events.filter((event) => event.sequence > cursor);
          for (const event of unseen) {
            await onEvent?.(event);
            cursor = Math.max(cursor, event.sequence);
            if (signal?.aborted || shouldStop?.()) break;
          }

          if (terminalRun(page.run) || signal?.aborted || shouldStop?.()) break;
          if (!page.hasMore && unseen.length === 0) {
            await waitWithSignal(pollIntervalMs, signal);
          }
        } catch (error) {
          if (isAbortError(error, signal)) break;
          if (!isRetryableSubscriptionError(error)) throw error;
          reconnectAttempt += 1;
          const delayMs = Math.min(
            maxReconnectDelayMs,
            Math.max(pollIntervalMs, 250) * (2 ** Math.min(reconnectAttempt - 1, 5)),
          );
          setConnection("reconnecting", { error, attempt: reconnectAttempt, delayMs, cursor });
          await waitWithSignal(delayMs, signal);
        }
      }
    } finally {
      setConnection("closed");
    }
    return { lastSequence: cursor };
  }

  return Object.freeze({
    startRun,
    getRun,
    listRunEvents,
    subscribeRunEvents,
    sendCommand,
    pauseRun,
    resumeRun,
    stopRun,
    undoRun,
  });
}

export const agentRunApi = createAgentRunApi();

export const startAgentRun = (...args) => agentRunApi.startRun(...args);
export const getAgentRun = (...args) => agentRunApi.getRun(...args);
export const listAgentRunEvents = (...args) => agentRunApi.listRunEvents(...args);
export const subscribeAgentRunEvents = (...args) => agentRunApi.subscribeRunEvents(...args);
export const sendAgentRunCommand = (...args) => agentRunApi.sendCommand(...args);
export const pauseAgentRun = (...args) => agentRunApi.pauseRun(...args);
export const resumeAgentRun = (...args) => agentRunApi.resumeRun(...args);
export const stopAgentRun = (...args) => agentRunApi.stopRun(...args);
export const undoAgentRun = (...args) => agentRunApi.undoRun(...args);
