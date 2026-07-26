import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentManager } from "../src/agent-manager.js";
import {
  AGENT_SYSTEM_INSTRUCTIONS,
  AgentProviderError,
  createMoonshotAgentProvider,
  createOpenAiAgentProvider
} from "../src/agent-provider.js";
import { loadConfig } from "../src/config.js";
import { createStore } from "../src/store.js";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function sampleRun(overrides = {}) {
  return {
    runId: "agent-run-provider-test",
    instruction: "我周六上午有事，请帮我重新规划",
    providerConversationState: null,
    ...overrides
  };
}

function sampleTrip(overrides = {}) {
  return {
    tripId: "trip-provider-test",
    timezone: "Asia/Shanghai",
    revisionId: "revision-1",
    plannerState: {
      constraints: [],
      transportModeOverrides: {}
    },
    stops: [
      {
        clientStopId: "stop-a",
        name: "雍和宫",
        scheduledTime: "09:00",
        durationMinutes: 60,
        locked: false
      },
      {
        clientStopId: "stop-b",
        name: "国子监",
        scheduledTime: "10:30",
        durationMinutes: 60,
        locked: false
      }
    ],
    ...overrides
  };
}

function chatToolCall(id, name, argumentsValue) {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(argumentsValue)
    }
  };
}

test("Agent prompt treats unavailable windows as hard constraints and requires convergence", () => {
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /上午有事/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /\[00:00, 12:00\)/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /Never satisfy a later-availability request by moving an affected stop earlier/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /derive a complete feasible target schedule internally/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /move the latest affected stop first and work backward/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /never repeat an equivalent tool call/i);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /call finish_replan immediately/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /Preserve every existing stop by default/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /remove_stop only as a last resort/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /不要删除/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /suggestedTimes/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /Never call move_stop when its new time equals/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /never call set_stop_lock when the stop already/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /act only on a currently listed constraint conflict/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /After exactly one tool call/);
  assert.match(AGENT_SYSTEM_INSTRUCTIONS, /same language as the user's instruction/);
});

test("OPENAI_MODEL=kimi resolves the backwards-compatible Moonshot defaults", () => {
  const config = loadConfig({
    OPENAI_API_KEY: "unit-test-key",
    OPENAI_MODEL: "kimi"
  });
  assert.equal(config.agentProvider, "moonshot");
  assert.equal(config.openAiAgentModel, "kimi-k2.6");
  assert.equal(config.openAiBaseUrl, "https://api.moonshot.cn/v1");

  const overridden = loadConfig({
    OPENAI_API_KEY: "unit-test-key",
    OPENAI_MODEL: "kimi",
    OPENAI_AGENT_MODEL: "kimi-k2.6-custom",
    OPENAI_BASE_URL: "https://gateway.example.test/v1"
  });
  assert.equal(overridden.agentProvider, "moonshot");
  assert.equal(overridden.openAiAgentModel, "kimi-k2.6-custom");
  assert.equal(overridden.openAiBaseUrl, "https://gateway.example.test/v1");

  const explicitOpenAi = loadConfig({
    AGENT_PROVIDER: "openai",
    OPENAI_API_KEY: "unit-test-key",
    OPENAI_AGENT_MODEL: "gpt-explicit",
    OPENAI_BASE_URL: "https://api.openai.com/v1"
  });
  assert.equal(explicitOpenAi.agentProvider, "openai");
  assert.equal(explicitOpenAi.openAiAgentModel, "gpt-explicit");
  assert.equal(explicitOpenAi.openAiBaseUrl, "https://api.openai.com/v1");
});

test("Moonshot sends Chat tools and preserves assistant tool_calls plus tool results", async () => {
  const requests = [];
  const replies = [
    {
      id: "chatcmpl-1",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [chatToolCall("call-1", "move_stop", {
            client_stop_id: "stop-a",
            new_scheduled_time: "13:00",
            reason: "避开周六上午"
          })]
        }
      }]
    },
    {
      id: "chatcmpl-2",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [chatToolCall("call-2", "finish_replan", {
            summary: "上午行程已移到下午"
          })]
        }
      }]
    }
  ];
  const provider = createMoonshotAgentProvider({
    apiKey: "unit-test-key",
    model: "kimi-k2.6",
    fetchImpl: async (url, init) => {
      requests.push({ url, init, payload: JSON.parse(init.body) });
      return response(replies.shift());
    }
  });

  const first = await provider.nextToolCall({
    run: sampleRun(),
    trip: sampleTrip()
  });
  assert.equal(first.call.toolName, "move_stop");
  assert.equal(first.call.arguments.new_scheduled_time, "13:00");
  assert.equal(requests[0].url, "https://api.moonshot.cn/v1/chat/completions");
  assert.equal(requests[0].payload.model, "kimi-k2.6");
  assert.deepEqual(requests[0].payload.thinking, { type: "disabled" });
  assert.equal(requests[0].payload.tool_choice, "required");
  assert.equal(requests[0].payload.parallel_tool_calls, false);
  assert.deepEqual(
    requests[0].payload.messages.map((message) => message.role),
    ["system", "user"]
  );
  const moonshotInitialInput = JSON.parse(requests[0].payload.messages[1].content);
  assert.equal(
    moonshotInitialInput.derivedConstraints.unavailableWindows[0].id,
    "saturday-morning"
  );
  assert.equal(
    moonshotInitialInput.derivedConstraints.unavailableWindows[0].endTime,
    "12:00"
  );
  assert.equal(moonshotInitialInput.planningHints.remainingConflictCount, 2);
  assert.equal(
    moonshotInitialInput.planningHints.nextActionCandidates[0]
      .arguments.client_stop_id,
    "stop-b"
  );
  assert.equal(requests[0].payload.tools[0].type, "function");
  assert.equal(requests[0].payload.tools[0].function.name, "move_stop");
  assert.equal(requests[0].payload.tools[0].function.strict, true);
  assert.equal("name" in requests[0].payload.tools[0], false);

  const toolOutput = {
    ok: true,
    toolName: "move_stop",
    clientStopId: "stop-a",
    before: { scheduledTime: "09:00" },
    after: { scheduledTime: "13:00" }
  };
  const second = await provider.nextToolCall({
    run: sampleRun({ providerConversationState: first.conversationState }),
    trip: sampleTrip({ revisionId: "revision-2" }),
    conversationState: first.conversationState,
    toolResult: {
      providerCallId: "call-1",
      output: toolOutput
    }
  });
  assert.equal(second.call.toolName, "finish_replan");
  assert.deepEqual(
    requests[1].payload.messages.map((message) => message.role),
    ["system", "user", "assistant", "tool"]
  );
  assert.deepEqual(
    requests[1].payload.messages[2].tool_calls,
    first.conversationState.messages[2].tool_calls
  );
  assert.equal(requests[1].payload.messages[3].tool_call_id, "call-1");
  assert.deepEqual(JSON.parse(requests[1].payload.messages[3].content), toolOutput);
  assert.deepEqual(
    second.conversationState.messages.map((message) => message.role),
    ["system", "user", "assistant", "tool", "assistant"]
  );
});

test("Moonshot retries only a required tool_choice compatibility rejection with auto", async () => {
  const payloads = [];
  const provider = createMoonshotAgentProvider({
    apiKey: "unit-test-key",
    model: "kimi-k2.6",
    fetchImpl: async (_url, init) => {
      payloads.push(JSON.parse(init.body));
      if (payloads.length === 1) {
        return response({
          error: {
            code: "invalid_request_error",
            message: "tool_choice required is not supported"
          }
        }, 400);
      }
      return response({
        id: "chatcmpl-fallback",
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [chatToolCall("call-fallback", "finish_replan", {
              summary: "无需调整"
            })]
          }
        }]
      });
    }
  });

  const result = await provider.nextToolCall({
    run: sampleRun(),
    trip: sampleTrip()
  });
  assert.equal(result.call.toolName, "finish_replan");
  assert.deepEqual(payloads.map((payload) => payload.tool_choice), ["required", "auto"]);
  assert.deepEqual(payloads[1].thinking, { type: "disabled" });
});

test("Moonshot rejects multiple tool calls and OpenAI keeps the Responses endpoint", async () => {
  const moonshot = createMoonshotAgentProvider({
    apiKey: "unit-test-key",
    model: "kimi-k2.6",
    fetchImpl: async () => response({
      id: "chatcmpl-invalid",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            chatToolCall("call-a", "finish_replan", { summary: "A" }),
            chatToolCall("call-b", "finish_replan", { summary: "B" })
          ]
        }
      }]
    })
  });
  await assert.rejects(
    moonshot.nextToolCall({ run: sampleRun(), trip: sampleTrip() }),
    (error) => (
      error instanceof AgentProviderError &&
      error.code === "AGENT_PROVIDER_INVALID_RESPONSE"
    )
  );

  let openAiRequest;
  const openAi = createOpenAiAgentProvider({
    apiKey: "unit-test-key",
    model: "gpt-test",
    fetchImpl: async (url, init) => {
      openAiRequest = { url, payload: JSON.parse(init.body) };
      return response({
        id: "resp-1",
        output: [{
          type: "function_call",
          call_id: "openai-call-1",
          name: "finish_replan",
          arguments: JSON.stringify({ summary: "完成" })
        }]
      });
    }
  });
  const openAiResult = await openAi.nextToolCall({
    run: sampleRun(),
    trip: sampleTrip()
  });
  assert.equal(openAiResult.call.toolName, "finish_replan");
  assert.equal(openAiRequest.url, "https://api.openai.com/v1/responses");
  assert.equal(openAiRequest.payload.tool_choice, "required");
  assert.equal(openAiRequest.payload.parallel_tool_calls, false);
  assert.equal(openAiRequest.payload.tools[0].name, "move_stop");
  const openAiInitialInput = JSON.parse(
    openAiRequest.payload.input[1].content[0].text
  );
  assert.equal(
    openAiInitialInput.derivedConstraints.unavailableWindows[0].id,
    "saturday-morning"
  );
  assert.equal(openAiInitialInput.planningHints.remainingConflictCount, 2);
  assert.equal(
    openAiInitialInput.planningHints.nextActionCandidates[0]
      .arguments.client_stop_id,
    "stop-b"
  );
});

test("Agent manager persists Moonshot conversation state without exposing it in run JSON", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-moonshot-state-"));
  const databasePath = join(temporaryDirectory, "agent.sqlite");
  let store = createStore({ filePath: databasePath });
  const trip = store.createTrip({
    tripId: "trip-moonshot-state",
    title: "Moonshot state test",
    city: "北京",
    timezone: "Asia/Shanghai",
    status: "DRAFT",
    sourceImportId: null,
    sourceUrl: null,
    source: { platform: "IN_APP", handoffMode: "DIRECT" },
    plannerState: {
      constraints: [],
      transportModeOverrides: {}
    },
    stops: sampleTrip().stops.map((stop) => ({
      ...stop,
      sourceStopId: null,
      placeId: null,
      providerRefs: [],
      note: "",
      address: "",
      latitude: null,
      longitude: null,
      coordSystem: null,
      imageUrl: null,
      category: null
    }))
  });
  const replies = [
    {
      id: "chatcmpl-state-1",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [chatToolCall("call-state-1", "move_stop", {
            client_stop_id: "stop-a",
            new_scheduled_time: "13:00",
            reason: "避开上午"
          })]
        }
      }]
    },
    {
      id: "chatcmpl-state-2",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [chatToolCall("call-state-2", "finish_replan", {
            summary: "已移动到下午"
          })]
        }
      }]
    }
  ];
  const provider = createMoonshotAgentProvider({
    apiKey: "unit-test-key",
    model: "kimi-k2.6",
    fetchImpl: async () => response(replies.shift())
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
      instruction: "把上午行程移到下午"
    });
    await manager.waitForIdle(run.runId);
    const internal = store.getAgentRunInternal(run.runId);
    assert.equal(internal.status, "COMPLETED");
    assert.deepEqual(
      internal.providerConversationState.messages.map((message) => message.role),
      ["system", "user", "assistant", "tool", "assistant"]
    );
    assert.equal(
      JSON.stringify(store.getAgentRun(run.runId)).includes("providerConversationState"),
      false
    );

    store.close();
    store = createStore({ filePath: databasePath });
    const restarted = store.getAgentRunInternal(run.runId);
    assert.equal(restarted.status, "COMPLETED");
    assert.deepEqual(
      restarted.providerConversationState.messages.map((message) => message.role),
      ["system", "user", "assistant", "tool", "assistant"]
    );
  } finally {
    store.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("Moonshot resumes an active run from persisted assistant and tool context after restart", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-moonshot-recover-"));
  const databasePath = join(temporaryDirectory, "agent.sqlite");
  let store = createStore({ filePath: databasePath });
  const trip = store.createTrip({
    tripId: "trip-moonshot-recover",
    title: "Moonshot restart recovery",
    city: "北京",
    timezone: "Asia/Shanghai",
    status: "DRAFT",
    sourceImportId: null,
    sourceUrl: null,
    source: { platform: "IN_APP", handoffMode: "DIRECT" },
    plannerState: {
      constraints: [],
      transportModeOverrides: {}
    },
    stops: sampleTrip().stops.map((stop) => ({
      ...stop,
      sourceStopId: null,
      placeId: null,
      providerRefs: [],
      note: "",
      address: "",
      latitude: null,
      longitude: null,
      coordSystem: null,
      imageUrl: null,
      category: null
    }))
  });
  const runId = "agent-run-moonshot-recover";
  const created = store.createQueuedAgentRun({
    runId,
    tripId: trip.tripId,
    ownerUserId: "demo-user",
    baseRevisionId: trip.revisionId,
    instruction: "把上午行程移到下午",
    provider: "moonshot",
    model: "kimi-k2.6"
  });
  store.transitionAgentRun({
    runId,
    fromStatuses: ["QUEUED"],
    toStatus: "PLANNING",
    eventType: "run.planning"
  });
  const firstProvider = createMoonshotAgentProvider({
    apiKey: "unit-test-key",
    model: "kimi-k2.6",
    fetchImpl: async () => response({
      id: "chatcmpl-recover-1",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [chatToolCall("call-recover-1", "move_stop", {
            client_stop_id: "stop-a",
            new_scheduled_time: "13:00",
            reason: "避开上午"
          })]
        }
      }]
    })
  });

  try {
    const firstTurn = await firstProvider.nextToolCall({
      run: store.getAgentRunInternal(runId),
      trip
    });
    const operation = store.recordAgentOperation({
      runId,
      providerCallId: firstTurn.call.providerCallId,
      toolName: firstTurn.call.toolName,
      arguments: firstTurn.call.arguments,
      providerResponseId: firstTurn.responseId,
      providerConversationState: firstTurn.conversationState
    });
    const movedStops = trip.stops.map((stop) => (
      stop.clientStopId === "stop-a"
        ? { ...stop, scheduledTime: "13:00" }
        : stop
    )).sort((left, right) => left.scheduledTime.localeCompare(right.scheduledTime));
    store.applyAgentOperation({
      runId,
      operationId: operation.operationId,
      stops: movedStops,
      output: {
        ok: true,
        toolName: "move_stop",
        clientStopId: "stop-a",
        before: { scheduledTime: "09:00" },
        after: { scheduledTime: "13:00" },
        reason: "避开上午"
      },
      reason: "TEST_MOONSHOT_RECOVERY"
    });
    assert.equal(store.getAgentRunInternal(runId).status, "RUNNING");

    store.close();
    store = createStore({ filePath: databasePath });
    let continuationPayload;
    const recoveredProvider = createMoonshotAgentProvider({
      apiKey: "unit-test-key",
      model: "kimi-k2.6",
      fetchImpl: async (_url, init) => {
        continuationPayload = JSON.parse(init.body);
        return response({
          id: "chatcmpl-recover-2",
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [chatToolCall("call-recover-2", "finish_replan", {
                summary: "重启后完成"
              })]
            }
          }]
        });
      }
    });
    const recoveredManager = createAgentManager({
      store,
      provider: recoveredProvider,
      logger: { error() {} }
    });
    recoveredManager.recover();
    await recoveredManager.waitForIdle(runId);

    assert.deepEqual(
      continuationPayload.messages.map((message) => message.role),
      ["system", "user", "assistant", "tool"]
    );
    assert.equal(continuationPayload.messages[2].tool_calls[0].id, "call-recover-1");
    assert.equal(continuationPayload.messages[3].tool_call_id, "call-recover-1");
    const recoveredToolOutput = JSON.parse(continuationPayload.messages[3].content);
    assert.equal(recoveredToolOutput.trip.revision, 2);
    assert.equal(
      recoveredToolOutput.trip.stops.find(
        (stop) => stop.clientStopId === "stop-a"
      ).scheduledTime,
      "13:00"
    );
    assert.equal(store.getAgentRunInternal(runId).status, "COMPLETED");
  } finally {
    store.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("Moonshot rebase starts a fresh conversation after pause, manual edit, and restart", async () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "route-story-moonshot-rebase-"));
  const databasePath = join(temporaryDirectory, "agent.sqlite");
  let store = createStore({ filePath: databasePath });
  const trip = store.createTrip({
    tripId: "trip-moonshot-rebase",
    title: "Moonshot rebase recovery",
    city: "北京",
    timezone: "Asia/Shanghai",
    status: "DRAFT",
    sourceImportId: null,
    sourceUrl: null,
    source: { platform: "IN_APP", handoffMode: "DIRECT" },
    plannerState: {
      constraints: [{ id: "original-pace", type: "pace", value: "relaxed" }],
      transportModeOverrides: {}
    },
    stops: sampleTrip().stops.map((stop) => ({
      ...stop,
      sourceStopId: null,
      placeId: null,
      providerRefs: [],
      note: "",
      address: "",
      latitude: null,
      longitude: null,
      coordSystem: null,
      imageUrl: null,
      category: null
    }))
  });
  const firstRequestStarted = deferred();
  const releaseFirstRequest = deferred();
  let firstPayload;
  const firstProvider = createMoonshotAgentProvider({
    apiKey: "unit-test-key",
    model: "kimi-k2.6",
    fetchImpl: async (_url, init) => {
      firstPayload = JSON.parse(init.body);
      firstRequestStarted.resolve();
      await releaseFirstRequest.promise;
      return response({
        id: "chatcmpl-rebase-old",
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [chatToolCall("move_stop_0", "move_stop", {
              client_stop_id: "stop-b",
              new_scheduled_time: "13:00",
              reason: "old plan before the manual edit"
            })]
          }
        }]
      });
    }
  });
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
    await firstRequestStarted.promise;
    const pauseAcknowledgement = firstManager.command(
      run.runId,
      "demo-user",
      "pause"
    );
    assert.equal(pauseAcknowledgement.status, "PAUSE_REQUESTED");
    releaseFirstRequest.resolve();
    await firstManager.waitForIdle(run.runId);

    const paused = store.getAgentRunInternal(run.runId);
    assert.equal(paused.status, "PAUSED");
    assert.equal(paused.operations.length, 1);
    assert.equal(paused.operations[0].status, "PENDING");
    assert.equal(paused.providerResponseId, "chatcmpl-rebase-old");
    assert.deepEqual(
      paused.providerConversationState.messages.map((message) => message.role),
      ["system", "user", "assistant"]
    );
    assert.equal(
      JSON.parse(firstPayload.messages[1].content)
        .planningHints.remainingConflictCount,
      2
    );

    const manualPlannerState = {
      constraints: [{
        id: "manual-preference",
        type: "pace",
        value: "slow"
      }],
      transportModeOverrides: {
        "stop-a:stop-b": "transit"
      }
    };
    const manualStops = trip.stops.map((stop) => {
      if (stop.clientStopId === "stop-a") {
        return { ...stop, scheduledTime: "09:00" };
      }
      return {
        ...stop,
        scheduledTime: "12:00",
        durationMinutes: 345
      };
    });
    const manualTrip = store.saveSchedule({
      tripId: trip.tripId,
      baseRevisionId: trip.revisionId,
      stops: manualStops,
      plannerState: manualPlannerState,
      reason: "TEST_MANUAL_REBASE"
    });
    assert.equal(manualTrip.revision, 2);

    store.close();
    store = createStore({ filePath: databasePath });
    const restartedPaused = store.getAgentRunInternal(run.runId);
    assert.equal(restartedPaused.status, "PAUSED");
    assert.equal(restartedPaused.operations[0].status, "PENDING");
    assert.equal(restartedPaused.providerResponseId, "chatcmpl-rebase-old");

    const freshPayloads = [];
    let providerLineageAtFreshRequest;
    const resumedProvider = createMoonshotAgentProvider({
      apiKey: "unit-test-key",
      model: "kimi-k2.6",
      fetchImpl: async (_url, init) => {
        freshPayloads.push(JSON.parse(init.body));
        if (freshPayloads.length === 1) {
          providerLineageAtFreshRequest = store.getAgentRunInternal(run.runId);
          return response({
            id: "chatcmpl-rebase-fresh-move",
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [chatToolCall("move_stop_0", "move_stop", {
                  client_stop_id: "stop-a",
                  new_scheduled_time: "17:45",
                  reason: "use the first feasible time from the rebased planning hints"
                })]
              }
            }]
          });
        }
        return response({
          id: "chatcmpl-rebase-fresh-finish",
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [chatToolCall("finish_replan_1", "finish_replan", {
                summary: "the rebased conflict was moved without reusing the old operation"
              })]
            }
          }]
        });
      }
    });
    const resumedManager = createAgentManager({
      store,
      provider: resumedProvider,
      logger: { error() {} }
    });
    const resumeAcknowledgement = resumedManager.command(
      run.runId,
      "demo-user",
      "resume",
      { baseRevisionId: manualTrip.revisionId }
    );
    assert.equal(resumeAcknowledgement.status, "RESUMING");
    await resumedManager.waitForIdle(run.runId);

    assert.equal(providerLineageAtFreshRequest.providerResponseId, null);
    assert.equal(providerLineageAtFreshRequest.providerConversationState, null);
    assert.deepEqual(
      freshPayloads[0].messages.map((message) => message.role),
      ["system", "user"]
    );
    assert.equal(
      freshPayloads[0].messages.some((message) => message.role === "tool"),
      false
    );
    const freshInput = JSON.parse(freshPayloads[0].messages[1].content);
    assert.equal(freshInput.trip.revisionId, manualTrip.revisionId);
    assert.deepEqual(freshInput.trip.plannerState, manualPlannerState);
    assert.deepEqual(
      freshInput.trip.stops.map((stop) => stop.scheduledTime),
      ["09:00", "12:00"]
    );
    assert.equal(freshInput.planningHints.remainingConflictCount, 1);
    assert.equal(
      freshInput.planningHints.nextActionCandidates[0].toolName,
      "move_stop"
    );
    assert.equal(
      freshInput.planningHints.nextActionCandidates[0]
        .arguments.new_scheduled_time,
      "17:45"
    );
    assert.deepEqual(
      freshPayloads[1].messages.map((message) => message.role),
      ["system", "user", "assistant", "tool"]
    );
    assert.equal(
      freshPayloads[1].messages[2].tool_calls[0].id,
      "move_stop_0"
    );
    assert.equal(
      freshPayloads[1].messages[3].tool_call_id,
      "move_stop_0"
    );

    const completed = store.getAgentRunInternal(run.runId);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.error, null);
    assert.deepEqual(
      completed.operations.map((operation) => operation.status),
      ["REJECTED", "APPLIED", "APPLIED"]
    );
    assert.equal(completed.operations[0].error.code, "AGENT_REBASED");
    assert.equal(
      completed.operations[0].providerCallId,
      "move_stop_0"
    );
    assert.equal(
      completed.operations[1].providerCallId,
      "move_stop_0"
    );
    assert.notEqual(
      completed.operations[0].operationId,
      completed.operations[1].operationId
    );
    assert.deepEqual(
      completed.operations.slice(0, 2).map(
        (operation) => operation.arguments.client_stop_id
      ),
      ["stop-b", "stop-a"]
    );
    assert.deepEqual(
      completed.operations.slice(0, 2).map(
        (operation) => operation.arguments.new_scheduled_time
      ),
      ["13:00", "17:45"]
    );
    assert.equal(
      completed.operations[2].providerCallId,
      "finish_replan_1"
    );
    assert.deepEqual(
      completed.providerConversationState.messages.map((message) => message.role),
      ["system", "user", "assistant", "tool", "assistant"]
    );
    const sameLineageReplay = store.recordAgentOperation({
      runId: run.runId,
      providerCallId: "move_stop_0",
      toolName: "move_stop",
      arguments: structuredClone(completed.operations[1].arguments),
      providerResponseId: "chatcmpl-rebase-fresh-move",
      providerConversationState: completed.providerConversationState
    });
    assert.equal(
      sameLineageReplay.operationId,
      completed.operations[1].operationId
    );
    assert.equal(store.getAgentRunInternal(run.runId).operations.length, 3);

    const finalTrip = store.getTrip(trip.tripId);
    assert.equal(finalTrip.stops.length, manualTrip.stops.length);
    assert.equal(
      finalTrip.stops.find((stop) => stop.clientStopId === "stop-a")
        .scheduledTime,
      "17:45"
    );
    const preservedManualStop = finalTrip.stops.find(
      (stop) => stop.clientStopId === "stop-b"
    );
    assert.equal(preservedManualStop.scheduledTime, "12:00");
    assert.equal(preservedManualStop.durationMinutes, 345);
    assert.deepEqual(
      finalTrip.plannerState.transportModeOverrides,
      manualPlannerState.transportModeOverrides
    );
    assert.deepEqual(
      finalTrip.plannerState.constraints.slice(0, 1),
      manualPlannerState.constraints
    );
    assert.equal(
      finalTrip.plannerState.constraints.some(
        (constraint) => constraint.id === "saturday-morning"
      ),
      true
    );

    const events = store.listAgentEvents(run.runId, "demo-user", {
      after: 0,
      limit: 500
    }).events;
    const rejectedEvent = events.find(
      (event) => (
        event.type === "operation.rejected" &&
        event.payload.operation.operationId ===
          completed.operations[0].operationId
      )
    );
    assert.equal(rejectedEvent.payload.error.code, "AGENT_REBASED");
    assert.equal(
      rejectedEvent.payload.trip.revisionId,
      manualTrip.revisionId
    );
    const rejectedIndex = events.findIndex(
      (event) => event.eventId === rejectedEvent.eventId
    );
    const rebasedIndex = events.findIndex(
      (event) => event.type === "run.rebased"
    );
    assert.ok(rejectedIndex >= 0 && rebasedIndex > rejectedIndex);
  } finally {
    try {
      store.close();
    } catch {
      // Store may already be closed before the restart assertions.
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("Moonshot provider errors do not expose upstream messages or credentials", async () => {
  const secret = "unit-test-secret-that-must-not-leak";
  const provider = createMoonshotAgentProvider({
    apiKey: secret,
    model: "kimi-k2.6",
    fetchImpl: async () => response({
      error: {
        code: "invalid_authentication_error",
        message: `upstream rejected ${secret}`
      }
    }, 401)
  });

  await assert.rejects(
    provider.nextToolCall({ run: sampleRun(), trip: sampleTrip() }),
    (error) => {
      assert.equal(error.code, "AGENT_PROVIDER_ERROR");
      assert.equal(error.status, 401);
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes("upstream rejected"), false);
      return true;
    }
  );
});
