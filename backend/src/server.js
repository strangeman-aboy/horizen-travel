import { createApiServer } from "./app.js";
import { createAgentManager } from "./agent-manager.js";
import {
  createMoonshotAgentProvider,
  createOpenAiAgentProvider,
  createUnavailableAgentProvider
} from "./agent-provider.js";
import { loadConfig } from "./config.js";
import { createJsonLogger } from "./logger.js";
import { createLocalProviderAdapters } from "./providers.js";
import { createStore } from "./store.js";
import { createXiaohongshuMetadataResolver } from "./xiaohongshu-metadata.js";

const config = loadConfig();
const logger = createJsonLogger();
const store = createStore({
  filePath: config.databasePath,
  idempotencyTtlHours: config.idempotencyTtlHours
});
const xiaohongshuMetadataResolver = config.xiaohongshuPublicMetadataEnabled
  ? createXiaohongshuMetadataResolver({
      timeoutMs: config.xiaohongshuPublicMetadataTimeoutMs,
      maxBytes: config.xiaohongshuPublicMetadataMaxBytes,
      maxRedirects: config.xiaohongshuPublicMetadataMaxRedirects,
      logger
    })
  : null;
const providerAdapters = createLocalProviderAdapters({
  store,
  xiaohongshuMetadataResolver
});
const agentProvider = config.agentProvider === "openai"
  ? createOpenAiAgentProvider({
      apiKey: config.openAiApiKey,
      model: config.openAiAgentModel,
      baseUrl: config.openAiBaseUrl,
      timeoutMs: config.agentProviderTimeoutMs
    })
  : config.agentProvider === "moonshot"
    ? createMoonshotAgentProvider({
        apiKey: config.openAiApiKey,
        model: config.openAiAgentModel,
        baseUrl: config.openAiBaseUrl,
        timeoutMs: config.agentProviderTimeoutMs
      })
    : createUnavailableAgentProvider({ reason: "The Agent provider is disabled." });
const agentManager = createAgentManager({
  store,
  provider: agentProvider,
  logger,
  maxSteps: config.agentMaxSteps
});
let draining = false;
let shutdownStarted = false;
let shutdownTimer = null;

const server = createApiServer({
  store,
  corsOrigin: config.corsOrigin,
  logger,
  authMode: config.authMode,
  serviceToken: config.serviceToken,
  requireIdempotency: config.requireIdempotency,
  providerAdapters,
  agentManager,
  isDraining: () => draining,
  shutdownToken: config.shutdownToken,
  onShutdown: (source) => shutdown(source)
});
agentManager.recover();

server.requestTimeout = config.requestTimeoutMs;
server.headersTimeout = config.headersTimeoutMs;
server.keepAliveTimeout = config.keepAliveTimeoutMs;

server.listen(config.port, config.host, () => {
  logger.info({
    event: "server_ready",
    timestamp: new Date().toISOString(),
    url: `http://${config.host}:${config.port}/api/v1`,
    environment: config.environmentName,
    authMode: config.authMode,
    schemaVersion: store.schemaVersion,
    persistence: "sqlite",
    providerMode: config.xiaohongshuPublicMetadataEnabled
      ? "public-metadata-demo-with-explicit-fallbacks"
      : "explicit-local-mocks"
  });
});

function finishShutdown(exitCode) {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  try {
    store.close();
  } catch (error) {
    logger.error({ event: "database_close_failed", error });
    exitCode = 1;
  }
  logger.info({
    event: "shutdown_complete",
    timestamp: new Date().toISOString(),
    exitCode
  });
  process.exit(exitCode);
}

function shutdown(source) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  draining = true;
  logger.info({
    event: "shutdown_started",
    timestamp: new Date().toISOString(),
    source
  });

  shutdownTimer = setTimeout(() => {
    logger.error({
      event: "shutdown_timeout",
      timestamp: new Date().toISOString(),
      timeoutMs: config.shutdownTimeoutMs
    });
    server.closeAllConnections?.();
    finishShutdown(1);
  }, config.shutdownTimeoutMs);
  shutdownTimer.unref();

  server.close((error) => {
    if (error) {
      logger.error({ event: "server_close_failed", error });
      finishShutdown(1);
      return;
    }
    finishShutdown(0);
  });
}

server.on("error", (error) => {
  logger.error({ event: "server_error", error });
  if (!server.listening) finishShutdown(1);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  logger.error({ event: "uncaught_exception", error });
  shutdown("UNCAUGHT_EXCEPTION");
});
process.on("unhandledRejection", (error) => {
  logger.error({ event: "unhandled_rejection", error });
  shutdown("UNHANDLED_REJECTION");
});
