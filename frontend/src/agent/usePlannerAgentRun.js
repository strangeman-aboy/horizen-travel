import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { ApiRequestError } from "../api/travelApi.js";
import { agentRunApi } from "../api/agentRunApi.js";
import {
  agentRunReducer,
  createInitialAgentRunState,
  ingestAgentRunEvents,
  isActiveAgentRunPhase,
  isTerminalAgentRunPhase,
  normalizeAgentRunError,
} from "./agentRunReducer.js";

const BUSY_PHASES = new Set([
  "starting",
  "pausing",
  "resuming",
  "stopping",
  "reconnecting",
  "undoing",
]);

function tripIdentity(tripSession) {
  return {
    tripId: tripSession?.tripId ?? tripSession?.id ?? null,
    revisionId: tripSession?.revisionId
      ?? tripSession?.headRevisionId
      ?? tripSession?.currentRevisionId
      ?? null,
  };
}

function callbackTripFromEvent(event) {
  return event.payload.trip
    ?? event.payload.snapshot
    ?? event.payload.plannerSnapshot
    ?? null;
}

function createHookError(message, code, details = null) {
  return new ApiRequestError(message, {
    code,
    details,
  });
}

export function usePlannerAgentRun({
  tripSession = null,
  onTripCommitted,
  onToast,
  api = agentRunApi,
} = {}) {
  const [state, dispatch] = useReducer(
    agentRunReducer,
    undefined,
    createInitialAgentRunState,
  );
  const stateRef = useRef(state);
  const tripSessionRef = useRef(tripSession);
  const onTripCommittedRef = useRef(onTripCommitted);
  const onToastRef = useRef(onToast);
  const subscriptionControllerRef = useRef(null);
  const requestControllerRef = useRef(null);
  const stateWaitersRef = useRef([]);

  tripSessionRef.current = tripSession;
  onTripCommittedRef.current = onTripCommitted;
  onToastRef.current = onToast;

  const settleStateWaiters = useCallback((nextState) => {
    const remaining = [];
    stateWaitersRef.current.forEach((waiter) => {
      if (waiter.predicate(nextState)) {
        globalThis.clearTimeout(waiter.timer);
        waiter.resolve(nextState);
        return;
      }
      if (["failed", "conflicted", "stopped", "completed"].includes(nextState.phase)) {
        globalThis.clearTimeout(waiter.timer);
        waiter.reject(createHookError(
          `Agent 当前状态为 ${nextState.phase}，无法完成等待中的操作。`,
          nextState.phase === "conflicted" ? "REVISION_CONFLICT" : "AGENT_RUN_STATE_CHANGED",
          { phase: nextState.phase },
        ));
        return;
      }
      remaining.push(waiter);
    });
    stateWaitersRef.current = remaining;
  }, []);

  const replaceState = useCallback((nextState) => {
    stateRef.current = nextState;
    dispatch({ type: "REPLACE", state: nextState });
    settleStateWaiters(nextState);
    return nextState;
  }, [settleStateWaiters]);

  const commitAction = useCallback((action) => (
    replaceState(agentRunReducer(stateRef.current, action))
  ), [replaceState]);

  const waitForState = useCallback((predicate, {
    timeoutMs = 20_000,
    description = "Agent 状态更新",
  } = {}) => {
    if (predicate(stateRef.current)) return Promise.resolve(stateRef.current);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: globalThis.setTimeout(() => {
          stateWaitersRef.current = stateWaitersRef.current.filter((item) => item !== waiter);
          reject(createHookError(
            `${description}等待超时。`,
            "AGENT_RUN_ACK_TIMEOUT",
            { phase: stateRef.current.phase, timeoutMs },
          ));
        }, timeoutMs),
      };
      stateWaitersRef.current.push(waiter);
    });
  }, []);

  const processEvent = useCallback(async (event) => {
    const ingestion = ingestAgentRunEvents(stateRef.current, [event]);
    if (!ingestion.acceptedEvents.length) return;
    replaceState(ingestion.state);

    for (const acceptedEvent of ingestion.acceptedEvents) {
      if (
        acceptedEvent.type === "operation.applied"
        || acceptedEvent.type === "undo.applied"
      ) {
        await onTripCommittedRef.current?.(
          callbackTripFromEvent(acceptedEvent),
          acceptedEvent,
        );
      }
    }
  }, [replaceState]);

  const subscriptionEnabled = Boolean(
    state.runId
    && !isTerminalAgentRunPhase(state.phase),
  );

  useEffect(() => {
    if (!subscriptionEnabled || !state.runId || !state.tripId) return undefined;
    const controller = new AbortController();
    subscriptionControllerRef.current?.abort();
    subscriptionControllerRef.current = controller;

    api.subscribeRunEvents({
      tripId: state.tripId,
      runId: state.runId,
      afterSequence: stateRef.current.lastSequence,
      signal: controller.signal,
      onEvent: processEvent,
      onConnectionChange: (connection) => {
        if (controller.signal.aborted) return;
        commitAction({ type: "CONNECTION_CHANGED", connection });
      },
      shouldStop: () => (
        controller.signal.aborted
        || isTerminalAgentRunPhase(stateRef.current.phase)
      ),
    }).catch((error) => {
      if (controller.signal.aborted || error?.code === "API_REQUEST_ABORTED") return;
      commitAction({ type: "FAILURE", error });
      onToastRef.current?.(error?.message ?? "Agent 事件连接已中断。");
    });

    return () => {
      controller.abort();
      if (subscriptionControllerRef.current === controller) {
        subscriptionControllerRef.current = null;
      }
    };
  }, [
    api,
    commitAction,
    processEvent,
    state.runId,
    state.tripId,
    subscriptionEnabled,
  ]);

  useEffect(() => () => {
    subscriptionControllerRef.current?.abort();
    requestControllerRef.current?.abort();
    const error = createHookError("Agent 控制器已卸载。", "AGENT_RUN_CONTROLLER_UNMOUNTED");
    stateWaitersRef.current.forEach((waiter) => {
      globalThis.clearTimeout(waiter.timer);
      waiter.reject(error);
    });
    stateWaitersRef.current = [];
  }, []);

  const start = useCallback(async (instruction, { tripSession: overrideSession } = {}) => {
    const identity = tripIdentity(overrideSession ?? tripSessionRef.current);
    if (!identity.tripId || !identity.revisionId) {
      const error = createHookError(
        "启动 Agent 前需要先保存行程草稿。",
        "AGENT_DRAFT_REQUIRED",
        identity,
      );
      onToastRef.current?.(error.message);
      throw error;
    }
    if (isActiveAgentRunPhase(stateRef.current.phase)) {
      throw createHookError(
        "已有 Agent Run 正在进行，请先停止或完成当前 Run。",
        "AGENT_RUN_ALREADY_ACTIVE",
        { runId: stateRef.current.runId, phase: stateRef.current.phase },
      );
    }

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    commitAction({
      type: "START_REQUESTED",
      tripId: identity.tripId,
      baseRevisionId: identity.revisionId,
      instruction,
    });

    try {
      const run = await api.startRun({
        tripId: identity.tripId,
        instruction,
        baseRevisionId: identity.revisionId,
        signal: controller.signal,
      });
      const next = commitAction({ type: "RUN_ACCEPTED", run });
      onToastRef.current?.("Agent 已接收指令，正在规划。");
      return next.run ?? run;
    } catch (error) {
      if (controller.signal.aborted) throw error;
      commitAction({ type: "FAILURE", error });
      onToastRef.current?.(error?.message ?? "Agent 启动失败。");
      throw error;
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  }, [api, commitAction]);

  const runCommand = useCallback(async (command, { baseRevisionId = null } = {}) => {
    const current = stateRef.current;
    if (!current.tripId || !current.runId) {
      throw createHookError("当前没有可控制的 Agent Run。", "AGENT_RUN_NOT_FOUND");
    }
    const normalizedCommand = String(command).toUpperCase();
    if (
      current.pendingCommand?.command === normalizedCommand
      && ["pausing", "resuming", "stopping"].includes(current.phase)
    ) {
      return current.run;
    }

    commitAction({
      type: "COMMAND_REQUESTED",
      command: normalizedCommand,
      baseRevisionId,
    });
    try {
      const run = await api.sendCommand({
        tripId: current.tripId,
        runId: current.runId,
        command: normalizedCommand,
        baseRevisionId,
      });
      const next = commitAction({ type: "COMMAND_ACKNOWLEDGED", run });
      return next.run ?? run;
    } catch (error) {
      commitAction({ type: "COMMAND_FAILED", error });
      onToastRef.current?.(error?.message ?? `Agent ${normalizedCommand} 操作失败。`);
      throw error;
    }
  }, [api, commitAction]);

  const pause = useCallback(async () => {
    const current = stateRef.current;
    if (current.phase === "paused") return current.run;
    if (current.phase === "pausing" && current.pendingCommand?.command === "PAUSE") {
      return waitForState((value) => value.phase === "paused", {
        description: "Agent 暂停确认",
      });
    }
    await runCommand("PAUSE");
    if (stateRef.current.phase === "paused") return stateRef.current.run;
    const pausedState = await waitForState((value) => value.phase === "paused", {
      description: "Agent 暂停确认",
    });
    return pausedState.run;
  }, [runCommand, waitForState]);

  const resume = useCallback(async ({ baseRevisionId = null } = {}) => {
    const identity = tripIdentity(tripSessionRef.current);
    const revision = baseRevisionId
      ?? identity.revisionId
      ?? stateRef.current.headRevisionId;
    if (!revision) {
      throw createHookError(
        "继续 Agent 前需要最新的行程 revision。",
        "MISSING_REVISION_ID",
      );
    }
    await runCommand("RESUME", { baseRevisionId: revision });
    if (stateRef.current.phase === "running") return stateRef.current.run;
    const runningState = await waitForState((value) => value.phase === "running", {
      description: "Agent 继续确认",
    });
    return runningState.run;
  }, [runCommand, waitForState]);

  const stop = useCallback(async () => {
    const current = stateRef.current;
    if (["stopped", "completed"].includes(current.phase)) return current.run;
    if (current.phase === "stopping" && current.pendingCommand?.command === "STOP") {
      const stoppedState = await waitForState(
        (value) => ["stopped", "completed"].includes(value.phase),
        { description: "Agent 停止确认" },
      );
      return stoppedState.run;
    }
    await runCommand("STOP");
    if (["stopped", "completed"].includes(stateRef.current.phase)) return stateRef.current.run;
    const stoppedState = await waitForState(
      (value) => ["stopped", "completed"].includes(value.phase),
      { description: "Agent 停止确认" },
    );
    return stoppedState.run;
  }, [runCommand, waitForState]);

  const undo = useCallback(async ({ expectedRevisionId = null } = {}) => {
    const current = stateRef.current;
    if (!current.tripId || !current.runId) {
      throw createHookError("当前没有可撤回的 Agent Run。", "AGENT_RUN_NOT_FOUND");
    }
    const identity = tripIdentity(tripSessionRef.current);
    const revision = expectedRevisionId
      ?? identity.revisionId
      ?? current.headRevisionId;
    if (!revision) {
      throw createHookError("撤回 Agent Run 需要当前行程 revision。", "MISSING_REVISION_ID");
    }

    commitAction({ type: "UNDO_REQUESTED" });
    try {
      const run = await api.undoRun({
        tripId: current.tripId,
        runId: current.runId,
        expectedRevisionId: revision,
      });
      const next = commitAction({ type: "UNDO_ACKNOWLEDGED", run });
      if (run?.committedTrip) {
        await onTripCommittedRef.current?.(run.committedTrip, {
          type: "undo.applied",
          runId: current.runId,
          payload: { trip: run.committedTrip },
        });
      }
      if (next.undoApplied || next.status === "UNDONE") return next.run ?? run;
      const undoneState = await waitForState((value) => value.undoApplied, {
        description: "Agent 撤回确认",
      });
      return undoneState.run ?? run;
    } catch (error) {
      commitAction({ type: "COMMAND_FAILED", error });
      onToastRef.current?.(error?.message ?? "撤回 Agent Run 失败。");
      throw error;
    }
  }, [api, commitAction]);

  const requestManualTakeover = useCallback(async () => {
    const current = stateRef.current;
    if (!isActiveAgentRunPhase(current.phase) || current.phase === "paused") {
      return current;
    }
    if (["stopping", "undoing"].includes(current.phase)) {
      throw createHookError(
        "Agent 正在结束当前 Run，暂时不能接管画布。",
        "AGENT_RUN_COMMAND_PENDING",
        { phase: current.phase },
      );
    }

    if (!(current.phase === "pausing" && current.pendingCommand?.command === "PAUSE")) {
      await pause();
    }
    if (stateRef.current.phase === "paused") return stateRef.current;
    return waitForState((value) => value.phase === "paused", {
      description: "人工接管编辑权",
    });
  }, [pause, waitForState]);

  const reset = useCallback(() => {
    subscriptionControllerRef.current?.abort();
    requestControllerRef.current?.abort();
    replaceState(createInitialAgentRunState());
  }, [replaceState]);

  const controls = useMemo(() => {
    const phase = state.phase;
    const isActive = isActiveAgentRunPhase(phase);
    const isBusy = BUSY_PHASES.has(phase);
    return {
      isActive,
      isBusy,
      canStart: !isActive,
      canPause: ["planning", "running", "resuming", "reconnecting"].includes(phase),
      canResume: phase === "paused" && !state.pendingCommand,
      canStop: [
        "starting",
        "planning",
        "running",
        "pausing",
        "paused",
        "resuming",
        "reconnecting",
      ].includes(phase),
      canUndo: Boolean(
        state.runId
        && state.baseRevisionId
        && ["paused", "stopped", "completed", "failed"].includes(phase)
        && !state.pendingCommand,
      ),
    };
  }, [state.baseRevisionId, state.pendingCommand, state.phase, state.runId]);

  return {
    state,
    run: state.run,
    operations: state.operations,
    previewOperation: state.previewOperation,
    changedStopIds: state.changedStopIds,
    ...controls,
    start,
    pause,
    resume,
    stop,
    undo,
    requestManualTakeover,
    reset,
  };
}

export default usePlannerAgentRun;
