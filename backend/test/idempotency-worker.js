import { parentPort, workerData } from "node:worker_threads";
import { createStore } from "../src/store.js";

const store = createStore({ filePath: workerData.databasePath });
parentPort.postMessage({ type: "ready" });

parentPort.once("message", (message) => {
  if (message.type !== "execute") return;
  try {
    const result = store.executeIdempotently({
      ownerUserId: "demo-user",
      method: "POST",
      routePattern: "/imports/xiaohongshu",
      key: "shared-worker-key",
      requestHash: "same-request-hash"
    }, () => {
      const capturedAt = "2026-07-25T00:00:00.000Z";
      const record = {
        importId: workerData.recordId,
        status: "READY_FOR_REVIEW",
        source: {
          platform: "XIAOHONGSHU",
          sourceUrl: "https://xhslink.com/a/atomic-test",
          capturedAt
        },
        extraction: { title: "atomic", city: "北京", stops: [] },
        warnings: []
      };
      store.createImport(record, "demo-user");
      return { status: 201, body: record, headers: { ETag: "\"atomic\"" } };
    });
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: { name: error.name, message: error.message, code: error.code }
    });
  } finally {
    store.close();
  }
});
