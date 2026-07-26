import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import viteConfig from "../vite.config.mjs";
import worker, { createSitesWorker } from "../worker/index.js";

const TEST_API_ORIGIN = "https://api.example.test";
const TEST_SERVICE_TOKEN = "service-token-for-worker-tests-000000000000";
const TEST_SESSION_KEY = "session-signing-key-for-worker-tests-000000";

function testEnvironment(overrides = {}) {
  return {
    API_ORIGIN: TEST_API_ORIGIN,
    API_SERVICE_TOKEN: TEST_SERVICE_TOKEN,
    SESSION_SIGNING_KEY: TEST_SESSION_KEY,
    ASSETS: {
      fetch: async () => new Response("missing", { status: 404 }),
    },
    ...overrides,
  };
}

function apiRequest(path, {
  method = "GET",
  headers = {},
  body,
} = {}) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      origin: "https://example.test",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body,
  });
}

function cookiePair(setCookie) {
  return setCookie?.split(";", 1)[0] ?? "";
}

test("uses localhost only for Vite development and same-origin for production", () => {
  const development = viteConfig({ command: "serve" });
  const production = viteConfig({ command: "build" });

  assert.equal(
    development.define.__TRAVEL_API_DEFAULT_ORIGIN__,
    JSON.stringify("http://127.0.0.1:8787"),
  );
  assert.equal(development.define.__TRAVEL_API_ALLOW_ENV_OVERRIDE__, "true");
  assert.equal(production.define.__TRAVEL_API_DEFAULT_ORIGIN__, JSON.stringify(""));
  assert.equal(production.define.__TRAVEL_API_ALLOW_ENV_OVERRIDE__, "false");
});

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  let calls = 0;
  const assets = {
    fetch: async () => {
      calls += 1;
      return new Response("missing", { status: 404 });
    },
  };

  const missingProxyResponse = await worker.fetch(
    apiRequest("/api/v1/trips"),
    { ASSETS: assets },
  );
  assert.equal(missingProxyResponse.status, 503);
  assert.equal(missingProxyResponse.headers.get("cache-control"), "no-store");
  assert.equal(calls, 0);

  for (const request of [
    new Request("https://example.test/api/missing", {
      headers: { accept: "application/json" },
    }),
    new Request("https://example.test/flow", {
      method: "POST",
      headers: { accept: "text/html" },
    }),
  ]) {
    const response = await worker.fetch(request, { ASSETS: assets });
    assert.equal(response.status, 404);
  }
  assert.equal(calls, 2);
});

test("proxies only allowlisted API headers and never exposes runtime secrets", async () => {
  let upstream;
  const sitesWorker = createSitesWorker({
    cryptoImpl: webcrypto,
    fetchImpl: async (url, init) => {
      upstream = {
        url: String(url),
        method: init.method,
        headers: new Headers(init.headers),
        body: init.body ? new TextDecoder().decode(init.body) : "",
      };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          authorization: `Bearer ${TEST_SERVICE_TOKEN}`,
          "cache-control": "public, max-age=600",
          etag: "\"rev-2\"",
          "set-cookie": "upstream-cookie=must-not-pass",
          "x-request-id": "upstream-request-1",
        },
      });
    },
  });

  const response = await sitesWorker.fetch(
    apiRequest("/api/v1/trips/trip-1/schedule?view=planner", {
      method: "PUT",
      headers: {
        authorization: "Bearer browser-controlled",
        cookie: "browser-cookie=must-not-pass",
        "content-type": "application/json",
        host: "attacker.invalid",
        "idempotency-key": "idem-1",
        "if-match": "\"rev-1\"",
        "x-request-id": "browser-request-1",
        "x-user-id": "forged-user",
      },
      body: JSON.stringify({ status: "DRAFT" }),
    }),
    testEnvironment(),
  );

  assert.equal(response.status, 200);
  assert.equal(upstream.url, `${TEST_API_ORIGIN}/api/v1/trips/trip-1/schedule?view=planner`);
  assert.equal(upstream.method, "PUT");
  assert.equal(upstream.headers.get("authorization"), `Bearer ${TEST_SERVICE_TOKEN}`);
  assert.match(upstream.headers.get("x-user-id"), /^anon-[a-f0-9]{32}$/u);
  assert.equal(upstream.headers.get("if-match"), "\"rev-1\"");
  assert.equal(upstream.headers.get("idempotency-key"), "idem-1");
  assert.equal(upstream.headers.get("x-request-id"), "browser-request-1");
  assert.equal(upstream.headers.get("host"), null);
  assert.equal(upstream.headers.get("origin"), null);
  assert.equal(upstream.headers.get("cookie"), null);
  assert.deepEqual(JSON.parse(upstream.body), { status: "DRAFT" });

  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("etag"), "\"rev-2\"");
  assert.equal(response.headers.get("authorization"), null);
  assert.equal(response.headers.get("x-request-id"), "upstream-request-1");
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /^__Host-jilu_session=v1\.[a-f0-9]{32}\.[A-Za-z0-9_-]{43};/u);
  assert.match(setCookie, /; HttpOnly; Secure; SameSite=Lax$/u);
  assert.doesNotMatch(setCookie, /upstream-cookie/u);

  const visibleResponse = [
    await response.text(),
    ...[...response.headers.entries()].flatMap(([name, value]) => [name, value]),
  ].join("\n");
  assert.doesNotMatch(visibleResponse, new RegExp(TEST_SERVICE_TOKEN, "u"));
  assert.doesNotMatch(visibleResponse, new RegExp(TEST_SESSION_KEY, "u"));
});

test("keeps a valid signed anonymous session stable and isolates new browsers", async () => {
  const userIds = [];
  const sitesWorker = createSitesWorker({
    cryptoImpl: webcrypto,
    fetchImpl: async (_url, init) => {
      userIds.push(new Headers(init.headers).get("x-user-id"));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const env = testEnvironment();

  const first = await sitesWorker.fetch(apiRequest("/api/v1/trips"), env);
  const second = await sitesWorker.fetch(apiRequest("/api/v1/trips"), env);
  const firstCookie = cookiePair(first.headers.get("set-cookie"));
  const secondCookie = cookiePair(second.headers.get("set-cookie"));

  assert.notEqual(userIds[0], userIds[1]);
  assert.notEqual(firstCookie, secondCookie);

  const resumed = await sitesWorker.fetch(
    apiRequest("/api/v1/trips", {
      headers: { cookie: firstCookie },
    }),
    env,
  );
  assert.equal(userIds[2], userIds[0]);
  assert.equal(resumed.headers.get("set-cookie"), null);
});

test("rejects a tampered session signature and rotates the anonymous identity", async () => {
  const userIds = [];
  const sitesWorker = createSitesWorker({
    cryptoImpl: webcrypto,
    fetchImpl: async (_url, init) => {
      userIds.push(new Headers(init.headers).get("x-user-id"));
      return new Response("{}", {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const env = testEnvironment();

  const initial = await sitesWorker.fetch(apiRequest("/api/v1/trips"), env);
  const initialCookie = cookiePair(initial.headers.get("set-cookie"));
  const replacement = initialCookie.endsWith("A") ? "B" : "A";
  const tamperedCookie = initialCookie.slice(0, -1) + replacement;

  const tampered = await sitesWorker.fetch(
    apiRequest("/api/v1/trips", {
      headers: { cookie: tamperedCookie },
    }),
    env,
  );

  assert.notEqual(userIds[1], userIds[0]);
  assert.notEqual(cookiePair(tampered.headers.get("set-cookie")), initialCookie);
});

test("denies cross-origin and unsupported API requests before proxying", async () => {
  let upstreamCalls = 0;
  let assetCalls = 0;
  const sitesWorker = createSitesWorker({
    cryptoImpl: webcrypto,
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response("{}");
    },
  });
  const env = testEnvironment({
    ASSETS: {
      fetch: async () => {
        assetCalls += 1;
        return new Response("missing", { status: 404 });
      },
    },
  });

  const crossOrigin = await sitesWorker.fetch(
    apiRequest("/api/v1/trips", {
      method: "POST",
      headers: {
        origin: "https://attacker.invalid",
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      },
      body: "{}",
    }),
    env,
  );
  assert.equal(crossOrigin.status, 403);

  const unsupportedMethod = await sitesWorker.fetch(
    apiRequest("/api/v1/trips", {
      method: "PURGE",
    }),
    env,
  );
  assert.equal(unsupportedMethod.status, 405);

  const outsidePrefix = await sitesWorker.fetch(
    apiRequest("/api/v10/trips"),
    env,
  );
  assert.equal(outsidePrefix.status, 404);
  assert.equal(upstreamCalls, 0);
  assert.equal(assetCalls, 1);
});

test("uses safe 503 and 502 failure semantics without an app-shell fallback", async () => {
  let assetCalls = 0;
  const assets = {
    fetch: async () => {
      assetCalls += 1;
      return new Response("<html>app shell</html>");
    },
  };
  const unconfiguredWorker = createSitesWorker({ cryptoImpl: webcrypto });
  const unconfigured = await unconfiguredWorker.fetch(
    apiRequest("/api/v1/trips"),
    { ASSETS: assets },
  );
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await unconfigured.text(), /API_ORIGIN|API_SERVICE_TOKEN|SESSION_SIGNING_KEY/u);

  const unavailableWorker = createSitesWorker({
    cryptoImpl: webcrypto,
    fetchImpl: async () => {
      throw new Error("origin details must not reach the client");
    },
  });
  const unavailable = await unavailableWorker.fetch(
    apiRequest("/api/v1/trips"),
    testEnvironment({ ASSETS: assets }),
  );
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
  assert.equal(unavailable.headers.get("retry-after"), "5");
  assert.doesNotMatch(await unavailable.text(), /origin details|api\.example\.test/u);
  assert.equal(assetCalls, 0);
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});

test("production JavaScript uses the same-origin API and contains no localhost backend", async () => {
  const assetsDirectory = new URL("../dist/client/assets/", import.meta.url);
  const javascriptFiles = (await readdir(assetsDirectory))
    .filter((name) => name.endsWith(".js"));
  assert.ok(javascriptFiles.length > 0);

  const bundle = (
    await Promise.all(
      javascriptFiles.map((name) => readFile(new URL(name, assetsDirectory), "utf8")),
    )
  ).join("\n");

  assert.match(bundle, /\/api\/v1/u);
  assert.doesNotMatch(bundle, /127\.0\.0\.1:8787|localhost:8787/u);
});
