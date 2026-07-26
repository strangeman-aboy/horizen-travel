import { deriveAgentConstraints } from "./agent-constraints.js";
import { buildAgentPlanningHints } from "./agent-planning.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MOONSHOT_BASE_URL = "https://api.moonshot.cn/v1";

export const AGENT_TOOL_DEFINITIONS = Object.freeze([
  {
    type: "function",
    name: "move_stop",
    description: "Move one existing unlocked itinerary stop to a new local start time.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        client_stop_id: { type: "string", minLength: 1, maxLength: 120 },
        new_scheduled_time: {
          type: "string",
          description: "Local time in 24-hour HH:MM format on a 15-minute boundary.",
          pattern: "^(?:[01]\\d|2[0-3]):(?:00|15|30|45)$"
        },
        reason: { type: "string", minLength: 1, maxLength: 500 }
      },
      required: ["client_stop_id", "new_scheduled_time", "reason"]
    }
  },
  {
    type: "function",
    name: "set_stop_lock",
    description: "Lock or unlock one existing itinerary stop.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        client_stop_id: { type: "string", minLength: 1, maxLength: 120 },
        locked: { type: "boolean" },
        reason: { type: "string", minLength: 1, maxLength: 500 }
      },
      required: ["client_stop_id", "locked", "reason"]
    }
  },
  {
    type: "function",
    name: "remove_stop",
    description: "Remove one existing unlocked itinerary stop when the user's request requires it.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        client_stop_id: { type: "string", minLength: 1, maxLength: 120 },
        reason: { type: "string", minLength: 1, maxLength: 500 }
      },
      required: ["client_stop_id", "reason"]
    }
  },
  {
    type: "function",
    name: "finish_replan",
    description: "Finish the replan only after all necessary itinerary changes have been applied.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string", minLength: 1, maxLength: 1000 }
      },
      required: ["summary"]
    }
  }
]);

export const MOONSHOT_CHAT_TOOL_DEFINITIONS = Object.freeze(
  AGENT_TOOL_DEFINITIONS.map((tool) => Object.freeze({
    type: "function",
    function: Object.freeze({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: tool.strict
    })
  }))
);

export const AGENT_SYSTEM_INSTRUCTIONS = [
  "You are a constrained itinerary replanning agent.",
  "Use exactly one provided function tool per response.",
  "Never invent stop ids. Work only with the supplied trip snapshot.",
  "Preserve every existing stop by default.",
  "Respect locked stops unless the user explicitly asks to unlock one.",
  "Never call move_stop when its new time equals the current time, and never call set_stop_lock when the stop already has the requested lock state.",
  "Interpret every natural-language unavailable period as a hard scheduling constraint.",
  "Chinese phrases such as 上午有事, 上午没空, 上午不可安排, or 上午不能安排 mean no stop may be scheduled in the local-time interval [00:00, 12:00).",
  "Likewise, 下午 means [12:00, 18:00) and 晚上 means [18:00, 24:00) unless the user states a more precise interval.",
  "Never satisfy a later-availability request by moving an affected stop earlier. Move it after the blocked interval.",
  "Use remove_stop only as a last resort when that stop has no feasible non-overlapping 15-minute-grid time left in the same day, unless the user explicitly and affirmatively authorizes deletion or cancellation.",
  "A negative instruction such as 不要删除 or 不想取消 never authorizes removal.",
  "Times are local to the trip timezone and must use HH:MM on 15-minute boundaries.",
  "Avoid overlapping stops. Use finish_replan when the request is satisfied.",
  "Before the first tool call, derive a complete feasible target schedule internally from the current trip, all hard unavailable periods, durations, and locked reservations.",
  "Execute that target in an order that keeps every intermediate schedule valid: when shifting stops later, move the latest affected stop first and work backward; when shifting earlier, move the earliest affected stop first; remove a stop only under the last-resort rule.",
  "After every tool result, discard assumptions and verify the entire returned canonical trip snapshot before choosing the next action.",
  "At every turn, read planningHints and act only on a currently listed constraint conflict. Prefer the first server-validated nextActionCandidate and its suggested time.",
  "After exactly one tool call, reread the returned planningHints before acting again. Do not spend tools on unchanged or already-locked non-conflicting stops.",
  "If a tool result is rejected, never repeat an equivalent tool call with the same target and arguments. Use suggestedTimes from REMOVAL_NOT_REQUIRED when present, choose a materially different valid move, or call finish_replan if the current trip already satisfies the request.",
  "Minimize operations and call finish_replan immediately once all hard constraints and protected reservations are satisfied.",
  "Write every tool reason and the final summary in the same language as the user's instruction; for a Chinese instruction, use concise Chinese.",
  "Do not return prose instead of a function call."
].join("\n");

export class AgentProviderError extends Error {
  constructor(code, message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = "AgentProviderError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function safeJsonParse(value, code, message) {
  try {
    return JSON.parse(value);
  } catch {
    throw new AgentProviderError(code, message);
  }
}

function normalizedBaseUrl(value) {
  return String(value || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
}

export function createUnavailableAgentProvider({
  reason = "OPENAI_API_KEY is not configured.",
  providerName = "openai"
} = {}) {
  return {
    available: false,
    providerName,
    modelName: null,
    unavailableReason: reason,
    async nextToolCall() {
      throw new AgentProviderError("AGENT_PROVIDER_UNAVAILABLE", reason);
    }
  };
}

export function createOpenAiAgentProvider({
  apiKey,
  model,
  baseUrl = DEFAULT_OPENAI_BASE_URL,
  timeoutMs = 45_000,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for the OpenAI Agent provider.");
  }
  const normalizedKey = typeof apiKey === "string" ? apiKey.trim() : "";
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  if (!normalizedKey) return createUnavailableAgentProvider();
  if (!normalizedModel) {
    return createUnavailableAgentProvider({
      reason: "OPENAI_AGENT_MODEL is not configured."
    });
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error("Agent provider timeoutMs must be between 1000 and 120000.");
  }

  return {
    available: true,
    providerName: "openai",
    modelName: normalizedModel,
    supportsRecovery: true,
    async nextToolCall({
      run,
      trip,
      previousResponseId = null,
      toolResult = null,
      derivedConstraints = deriveAgentConstraints(run.instruction),
      planningHints = buildAgentPlanningHints(trip, derivedConstraints),
      signal = null
    }) {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const requestSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;
      const input = previousResponseId && toolResult
        ? [{
            type: "function_call_output",
            call_id: toolResult.providerCallId,
            output: JSON.stringify(toolResult.output)
          }]
        : [
            {
              role: "system",
              content: [{ type: "input_text", text: AGENT_SYSTEM_INSTRUCTIONS }]
            },
            {
              role: "user",
              content: [{
                type: "input_text",
                text: JSON.stringify({
                  instruction: run.instruction,
                  derivedConstraints,
                  planningHints,
                  trip: {
                    tripId: trip.tripId,
                    timezone: trip.timezone,
                    revisionId: trip.revisionId,
                    plannerState: trip.plannerState,
                    stops: trip.stops.map((stop) => ({
                      clientStopId: stop.clientStopId,
                      name: stop.name,
                      scheduledTime: stop.scheduledTime,
                      durationMinutes: stop.durationMinutes,
                      locked: stop.locked
                    }))
                  }
                })
              }]
            }
          ];
      const payload = {
        model: normalizedModel,
        input,
        tools: AGENT_TOOL_DEFINITIONS,
        tool_choice: "required",
        parallel_tool_calls: false,
        store: true
      };
      if (previousResponseId) payload.previous_response_id = previousResponseId;

      let response;
      try {
        response = await fetchImpl(`${normalizedBaseUrl(baseUrl)}/responses`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${normalizedKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload),
          signal: requestSignal
        });
      } catch (error) {
        if (error?.name === "AbortError" || error?.name === "TimeoutError") {
          throw new AgentProviderError(
            "AGENT_PROVIDER_TIMEOUT",
            "The model provider did not respond before the configured timeout.",
            { retryable: true }
          );
        }
        throw new AgentProviderError(
          "AGENT_PROVIDER_NETWORK_ERROR",
          "The model provider request failed.",
          { retryable: true }
        );
      }

      const rawBody = await response.text();
      const responseBody = safeJsonParse(
        rawBody,
        "AGENT_PROVIDER_INVALID_RESPONSE",
        "The model provider returned invalid JSON."
      );
      if (!response.ok) {
        throw new AgentProviderError(
          "AGENT_PROVIDER_ERROR",
          "The model provider rejected the request.",
          { retryable: response.status === 429 || response.status >= 500, status: response.status }
        );
      }
      if (typeof responseBody.id !== "string" || !Array.isArray(responseBody.output)) {
        throw new AgentProviderError(
          "AGENT_PROVIDER_INVALID_RESPONSE",
          "The model provider response is missing its id or output."
        );
      }
      const functionCalls = responseBody.output.filter((item) => item?.type === "function_call");
      if (functionCalls.length !== 1) {
        throw new AgentProviderError(
          "AGENT_PROVIDER_INVALID_RESPONSE",
          "The model must return exactly one function call per turn."
        );
      }
      const functionCall = functionCalls[0];
      if (
        typeof functionCall.call_id !== "string" ||
        typeof functionCall.name !== "string" ||
        typeof functionCall.arguments !== "string"
      ) {
        throw new AgentProviderError(
          "AGENT_PROVIDER_INVALID_RESPONSE",
          "The model function call is incomplete."
        );
      }
      const operationArguments = safeJsonParse(
        functionCall.arguments,
        "AGENT_PROVIDER_INVALID_ARGUMENTS",
        "The model function arguments are invalid JSON."
      );
      if (
        operationArguments === null ||
        typeof operationArguments !== "object" ||
        Array.isArray(operationArguments)
      ) {
        throw new AgentProviderError(
          "AGENT_PROVIDER_INVALID_ARGUMENTS",
          "The model function arguments must be a JSON object."
        );
      }
      return {
        responseId: responseBody.id,
        call: {
          providerCallId: functionCall.call_id,
          toolName: functionCall.name,
          arguments: operationArguments
        }
      };
    }
  };
}

function createMoonshotInitialMessages(
  run,
  trip,
  derivedConstraints,
  planningHints
) {
  return [
    {
      role: "system",
      content: AGENT_SYSTEM_INSTRUCTIONS
    },
    {
      role: "user",
      content: JSON.stringify({
        instruction: run.instruction,
        derivedConstraints,
        planningHints,
        trip: {
          tripId: trip.tripId,
          timezone: trip.timezone,
          revisionId: trip.revisionId,
          plannerState: trip.plannerState,
          stops: trip.stops.map((stop) => ({
            clientStopId: stop.clientStopId,
            name: stop.name,
            scheduledTime: stop.scheduledTime,
            durationMinutes: stop.durationMinutes,
            locked: stop.locked
          }))
        }
      })
    }
  ];
}

function restoreMoonshotMessages(
  conversationState,
  run,
  trip,
  derivedConstraints,
  planningHints
) {
  if (conversationState == null) {
    return createMoonshotInitialMessages(
      run,
      trip,
      derivedConstraints,
      planningHints
    );
  }
  if (
    conversationState.provider !== "moonshot-chat-completions" ||
    conversationState.version !== 1 ||
    !Array.isArray(conversationState.messages) ||
    conversationState.messages.length < 2
  ) {
    throw new AgentProviderError(
      "AGENT_PROVIDER_STATE_INVALID",
      "The persisted Moonshot conversation state is invalid."
    );
  }
  return structuredClone(conversationState.messages);
}

function appendMoonshotToolResult(messages, toolResult) {
  if (!toolResult) return;
  const previousAssistant = messages.at(-1);
  const matchingCall = previousAssistant?.role === "assistant"
    ? previousAssistant.tool_calls?.find(
        (toolCall) => toolCall?.id === toolResult.providerCallId
      )
    : null;
  if (!matchingCall) {
    throw new AgentProviderError(
      "AGENT_PROVIDER_STATE_INVALID",
      "The persisted Moonshot conversation does not match the pending tool result."
    );
  }
  messages.push({
    role: "tool",
    tool_call_id: toolResult.providerCallId,
    content: JSON.stringify(toolResult.output)
  });
}

function shouldRetryMoonshotWithAuto(response, responseBody, toolChoice) {
  if (toolChoice !== "required" || response.status !== 400) return false;
  const upstreamMessage = [
    responseBody?.error?.code,
    responseBody?.error?.message,
    responseBody?.message
  ].filter(Boolean).join(" ");
  return /tool[_ ]choice/i.test(upstreamMessage) && /required/i.test(upstreamMessage);
}

function moonshotAssistantMessage(message, toolCall) {
  const assistantMessage = {
    role: "assistant",
    content: typeof message.content === "string" ? message.content : null,
    tool_calls: [{
      id: toolCall.id,
      type: "function",
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments
      }
    }]
  };
  if (typeof message.reasoning_content === "string") {
    assistantMessage.reasoning_content = message.reasoning_content;
  }
  return assistantMessage;
}

export function createMoonshotAgentProvider({
  apiKey,
  model = "kimi-k2.6",
  baseUrl = DEFAULT_MOONSHOT_BASE_URL,
  timeoutMs = 45_000,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for the Moonshot Agent provider.");
  }
  const normalizedKey = typeof apiKey === "string" ? apiKey.trim() : "";
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  if (!normalizedKey) {
    return createUnavailableAgentProvider({ providerName: "moonshot" });
  }
  if (!normalizedModel) {
    return createUnavailableAgentProvider({
      reason: "OPENAI_AGENT_MODEL is not configured.",
      providerName: "moonshot"
    });
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error("Agent provider timeoutMs must be between 1000 and 120000.");
  }

  return {
    available: true,
    providerName: "moonshot",
    modelName: normalizedModel,
    supportsRecovery: true,
    async nextToolCall({
      run,
      trip,
      toolResult = null,
      conversationState = run.providerConversationState ?? null,
      derivedConstraints = deriveAgentConstraints(run.instruction),
      planningHints = buildAgentPlanningHints(trip, derivedConstraints),
      signal = null
    }) {
      const messages = restoreMoonshotMessages(
        conversationState,
        run,
        trip,
        derivedConstraints,
        planningHints
      );
      appendMoonshotToolResult(messages, toolResult);
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const requestSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;
      let toolChoice = "required";
      let response;
      let responseBody;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const payload = {
          model: normalizedModel,
          messages,
          tools: MOONSHOT_CHAT_TOOL_DEFINITIONS,
          tool_choice: toolChoice,
          parallel_tool_calls: false,
          thinking: { type: "disabled" }
        };
        try {
          response = await fetchImpl(
            `${normalizedBaseUrl(baseUrl)}/chat/completions`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${normalizedKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload),
              signal: requestSignal
            }
          );
        } catch (error) {
          if (error?.name === "AbortError" || error?.name === "TimeoutError") {
            throw new AgentProviderError(
              "AGENT_PROVIDER_TIMEOUT",
              "The model provider did not respond before the configured timeout.",
              { retryable: true }
            );
          }
          throw new AgentProviderError(
            "AGENT_PROVIDER_NETWORK_ERROR",
            "The model provider request failed.",
            { retryable: true }
          );
        }

        const rawBody = await response.text();
        responseBody = safeJsonParse(
          rawBody,
          "AGENT_PROVIDER_INVALID_RESPONSE",
          "The model provider returned invalid JSON."
        );
        if (response.ok) break;
        if (shouldRetryMoonshotWithAuto(response, responseBody, toolChoice)) {
          toolChoice = "auto";
          continue;
        }
        throw new AgentProviderError(
          "AGENT_PROVIDER_ERROR",
          "The model provider rejected the request.",
          { retryable: response.status === 429 || response.status >= 500, status: response.status }
        );
      }

      if (!response?.ok) {
        throw new AgentProviderError(
          "AGENT_PROVIDER_ERROR",
          "The model provider rejected the request.",
          { retryable: false, status: response?.status ?? null }
        );
      }
      if (
        typeof responseBody?.id !== "string" ||
        !Array.isArray(responseBody.choices) ||
        responseBody.choices.length !== 1
      ) {
        throw new AgentProviderError(
          "AGENT_PROVIDER_INVALID_RESPONSE",
          "The model provider response is missing its id or single choice."
        );
      }
      const message = responseBody.choices[0]?.message;
      const toolCalls = message?.tool_calls;
      if (!Array.isArray(toolCalls) || toolCalls.length !== 1) {
        throw new AgentProviderError(
          "AGENT_PROVIDER_INVALID_RESPONSE",
          "The model must return exactly one function call per turn."
        );
      }
      const toolCall = toolCalls[0];
      if (
        toolCall?.type !== "function" ||
        typeof toolCall.id !== "string" ||
        typeof toolCall.function?.name !== "string" ||
        typeof toolCall.function?.arguments !== "string"
      ) {
        throw new AgentProviderError(
          "AGENT_PROVIDER_INVALID_RESPONSE",
          "The model function call is incomplete."
        );
      }
      const operationArguments = safeJsonParse(
        toolCall.function.arguments,
        "AGENT_PROVIDER_INVALID_ARGUMENTS",
        "The model function arguments are invalid JSON."
      );
      if (
        operationArguments === null ||
        typeof operationArguments !== "object" ||
        Array.isArray(operationArguments)
      ) {
        throw new AgentProviderError(
          "AGENT_PROVIDER_INVALID_ARGUMENTS",
          "The model function arguments must be a JSON object."
        );
      }
      const assistantMessage = moonshotAssistantMessage(message, toolCall);
      return {
        responseId: responseBody.id,
        conversationState: {
          provider: "moonshot-chat-completions",
          version: 1,
          messages: [...messages, assistantMessage]
        },
        call: {
          providerCallId: toolCall.id,
          toolName: toolCall.function.name,
          arguments: operationArguments
        }
      };
    }
  };
}

export function createScriptedAgentProvider({ script, beforeCall = null } = {}) {
  if (!Array.isArray(script) || script.length === 0) {
    throw new Error("A non-empty fake Agent script is required.");
  }
  const cursors = new Map();
  return {
    available: true,
    providerName: "fake",
    modelName: "fake-scripted",
    async nextToolCall(context) {
      await beforeCall?.(context);
      const cursor = cursors.get(context.run.runId) ?? 0;
      const scripted = script[Math.min(cursor, script.length - 1)];
      cursors.set(context.run.runId, cursor + 1);
      return {
        responseId: `fake-response-${context.run.runId}-${cursor + 1}`,
        call: {
          providerCallId: `fake-call-${context.run.runId}-${cursor + 1}`,
          toolName: scripted.toolName,
          arguments: structuredClone(scripted.arguments)
        }
      };
    }
  };
}
