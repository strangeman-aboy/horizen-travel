import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseInteger(value, name, fallback, { min, max }) {
  const raw = value == null || value === "" ? String(fallback) : String(value);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer.`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function parseBoolean(value, name, fallback) {
  if (value == null || value === "") return fallback;
  if (/^(?:1|true|yes)$/i.test(value)) return true;
  if (/^(?:0|false|no)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

function parseEnum(value, name, fallback, allowed) {
  const parsed = value == null || value === "" ? fallback : value;
  if (!allowed.includes(parsed)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return parsed;
}

function resolveAgentProvider(environment) {
  if (environment.AGENT_PROVIDER != null && environment.AGENT_PROVIDER !== "") {
    return parseEnum(
      environment.AGENT_PROVIDER,
      "AGENT_PROVIDER",
      "openai",
      ["openai", "moonshot", "disabled"]
    );
  }
  const legacyModel = environment.OPENAI_MODEL?.trim().toLocaleLowerCase("en-US");
  const explicitModel = environment.OPENAI_AGENT_MODEL?.trim().toLocaleLowerCase("en-US");
  const explicitBaseUrl = environment.OPENAI_BASE_URL?.trim().toLocaleLowerCase("en-US");
  if (
    legacyModel === "kimi" ||
    explicitModel?.startsWith("kimi-") ||
    explicitBaseUrl?.includes("api.moonshot.")
  ) {
    return "moonshot";
  }
  return "openai";
}

export function loadConfig(environment = process.env) {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const apiDirectory = resolve(moduleDirectory, "..");
  const defaultDatabasePath = resolve(apiDirectory, "data", "hackathon.sqlite");
  const environmentName = parseEnum(
    environment.API_ENV,
    "API_ENV",
    "local",
    ["local", "integration", "production"]
  );
  const authMode = parseEnum(
    environment.API_AUTH_MODE,
    "API_AUTH_MODE",
    environmentName === "local" ? "demo" : "service-token",
    ["demo", "service-token"]
  );
  const serviceToken = environment.API_SERVICE_TOKEN?.trim() || null;
  const corsOrigin = environment.CORS_ORIGIN?.trim() ||
    "http://127.0.0.1:5173,http://localhost:5173";

  if (authMode === "service-token" && !serviceToken) {
    throw new Error("API_SERVICE_TOKEN is required when API_AUTH_MODE=service-token.");
  }
  if (environmentName === "production" && authMode === "demo") {
    throw new Error("API_AUTH_MODE=demo is not allowed when API_ENV=production.");
  }
  if (environmentName === "production" && corsOrigin === "*") {
    throw new Error("CORS_ORIGIN must be an explicit allowlist when API_ENV=production.");
  }

  return {
    environmentName,
    databasePath: environment.API_DB_PATH
      ? resolve(environment.API_DB_PATH)
      : defaultDatabasePath,
    host: environment.API_HOST ?? "127.0.0.1",
    port: parseInteger(environment.API_PORT, "API_PORT", 8787, {
      min: 1,
      max: 65_535
    }),
    corsOrigin,
    authMode,
    serviceToken,
    requireIdempotency: parseBoolean(
      environment.API_REQUIRE_IDEMPOTENCY,
      "API_REQUIRE_IDEMPOTENCY",
      environmentName !== "local"
    ),
    idempotencyTtlHours: parseInteger(
      environment.API_IDEMPOTENCY_TTL_HOURS,
      "API_IDEMPOTENCY_TTL_HOURS",
      168,
      { min: 1, max: 8_760 }
    ),
    xiaohongshuPublicMetadataEnabled: parseBoolean(
      environment.XHS_PUBLIC_METADATA_ENABLED,
      "XHS_PUBLIC_METADATA_ENABLED",
      environmentName === "local"
    ),
    xiaohongshuPublicMetadataTimeoutMs: parseInteger(
      environment.XHS_PUBLIC_METADATA_TIMEOUT_MS,
      "XHS_PUBLIC_METADATA_TIMEOUT_MS",
      3_500,
      { min: 500, max: 10_000 }
    ),
    xiaohongshuPublicMetadataMaxBytes: parseInteger(
      environment.XHS_PUBLIC_METADATA_MAX_BYTES,
      "XHS_PUBLIC_METADATA_MAX_BYTES",
      524_288,
      { min: 16_384, max: 1_048_576 }
    ),
    xiaohongshuPublicMetadataMaxRedirects: parseInteger(
      environment.XHS_PUBLIC_METADATA_MAX_REDIRECTS,
      "XHS_PUBLIC_METADATA_MAX_REDIRECTS",
      3,
      { min: 0, max: 5 }
    ),
    agentProvider: resolveAgentProvider(environment),
    openAiApiKey: environment.OPENAI_API_KEY?.trim() || null,
    openAiAgentModel: environment.OPENAI_AGENT_MODEL?.trim() || (
      environment.OPENAI_MODEL?.trim().toLocaleLowerCase("en-US") === "kimi"
        ? "kimi-k2.6"
        : environment.OPENAI_MODEL?.trim()
    ) || null,
    openAiBaseUrl: environment.OPENAI_BASE_URL?.trim() || (
      resolveAgentProvider(environment) === "moonshot"
        ? "https://api.moonshot.cn/v1"
        : "https://api.openai.com/v1"
    ),
    agentProviderTimeoutMs: parseInteger(
      environment.AGENT_PROVIDER_TIMEOUT_MS,
      "AGENT_PROVIDER_TIMEOUT_MS",
      45_000,
      { min: 1_000, max: 120_000 }
    ),
    agentMaxSteps: parseInteger(
      environment.AGENT_MAX_STEPS,
      "AGENT_MAX_STEPS",
      24,
      { min: 1, max: 100 }
    ),
    requestTimeoutMs: parseInteger(
      environment.API_REQUEST_TIMEOUT_MS,
      "API_REQUEST_TIMEOUT_MS",
      15_000,
      { min: 1_000, max: 120_000 }
    ),
    headersTimeoutMs: parseInteger(
      environment.API_HEADERS_TIMEOUT_MS,
      "API_HEADERS_TIMEOUT_MS",
      10_000,
      { min: 1_000, max: 120_000 }
    ),
    keepAliveTimeoutMs: parseInteger(
      environment.API_KEEP_ALIVE_TIMEOUT_MS,
      "API_KEEP_ALIVE_TIMEOUT_MS",
      5_000,
      { min: 1_000, max: 60_000 }
    ),
    shutdownTimeoutMs: parseInteger(
      environment.API_SHUTDOWN_TIMEOUT_MS,
      "API_SHUTDOWN_TIMEOUT_MS",
      10_000,
      { min: 1_000, max: 60_000 }
    ),
    shutdownToken: environment.API_SHUTDOWN_TOKEN?.trim() || null
  };
}
