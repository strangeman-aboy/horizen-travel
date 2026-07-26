const API_PREFIX = "/api/v1";
const API_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REQUEST_HEADERS = [
  "accept",
  "content-type",
  "idempotency-key",
  "if-match",
  "if-none-match",
  "x-request-id",
];
const RESPONSE_HEADERS = [
  "content-type",
  "content-language",
  "content-disposition",
  "etag",
  "idempotency-replayed",
  "location",
  "retry-after",
  "x-request-id",
];
const SESSION_COOKIE_NAME = "__Host-jilu_session";
const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/u;
const SESSION_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MAX_REQUEST_BODY_BYTES = 1_000_000;
const MIN_SECRET_LENGTH = 32;
const encoder = new TextEncoder();

function isApiPath(pathname) {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

function apiHeaders(extra = {}) {
  return new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...extra,
  });
}

function apiError(status, code, message, extraHeaders = {}) {
  return new Response(JSON.stringify({
    error: {
      code,
      message,
    },
  }), {
    status,
    headers: apiHeaders(extraHeaders),
  });
}

function normalizeProxyConfig(env) {
  const rawOrigin = String(env?.API_ORIGIN ?? "").trim();
  const serviceToken = String(env?.API_SERVICE_TOKEN ?? "").trim();
  const sessionSigningKey = String(env?.SESSION_SIGNING_KEY ?? "").trim();

  if (
    serviceToken.length < MIN_SECRET_LENGTH
    || sessionSigningKey.length < MIN_SECRET_LENGTH
  ) {
    return null;
  }

  let origin;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return null;
  }

  if (
    origin.protocol !== "https:"
    || origin.username
    || origin.password
    || origin.search
    || origin.hash
    || !["", "/"].includes(origin.pathname)
  ) {
    return null;
  }

  return {
    apiOrigin: origin.origin,
    serviceToken,
    sessionSigningKey,
  };
}

function isSameOriginRequest(request, requestUrl) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) return false;

  const originHeader = request.headers.get("origin");
  if (originHeader) {
    try {
      if (new URL(originHeader).origin !== requestUrl.origin) return false;
    } catch {
      return false;
    }
  }

  return !MUTATING_METHODS.has(request.method) || Boolean(originHeader);
}

function parseCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function randomSessionId(cryptoImpl) {
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signSession(payload, secret, cryptoImpl) {
  const key = await cryptoImpl.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const signature = await cryptoImpl.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function serializeSessionCookie(value) {
  return [
    `${SESSION_COOKIE_NAME}=${value}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

async function resolveSession(request, signingKey, cryptoImpl) {
  if (
    !cryptoImpl
    || typeof cryptoImpl.getRandomValues !== "function"
    || !cryptoImpl.subtle
  ) {
    throw new Error("Web Crypto is unavailable.");
  }

  const existing = parseCookie(
    request.headers.get("cookie"),
    SESSION_COOKIE_NAME,
  );
  if (existing) {
    const [version, sessionId, signature, ...rest] = existing.split(".");
    if (
      rest.length === 0
      && version === "v1"
      && SESSION_ID_PATTERN.test(sessionId ?? "")
      && SESSION_SIGNATURE_PATTERN.test(signature ?? "")
    ) {
      const payload = `${version}.${sessionId}`;
      const expected = await signSession(payload, signingKey, cryptoImpl);
      if (constantTimeEqual(signature, expected)) {
        return {
          userId: `anon-${sessionId}`,
          setCookie: null,
        };
      }
    }
  }

  const sessionId = randomSessionId(cryptoImpl);
  const payload = `v1.${sessionId}`;
  const signature = await signSession(payload, signingKey, cryptoImpl);
  return {
    userId: `anon-${sessionId}`,
    setCookie: serializeSessionCookie(`${payload}.${signature}`),
  };
}

async function readRequestBody(request) {
  if (["GET", "HEAD"].includes(request.method)) return undefined;

  const declaredLength = request.headers.get("content-length");
  if (declaredLength != null) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength)
      || parsedLength < 0
      || parsedLength > MAX_REQUEST_BODY_BYTES
    ) {
      throw new RangeError("Request body is too large.");
    }
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new RangeError("Request body is too large.");
  }
  return body.byteLength > 0 ? body : undefined;
}

function buildUpstreamHeaders(request, config, userId) {
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value != null) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${config.serviceToken}`);
  headers.set("x-user-id", userId);
  return headers;
}

function buildClientHeaders(upstreamResponse, setCookie) {
  const headers = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstreamResponse.headers.get(name);
    if (value != null) headers.set(name, value);
  }
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  if (setCookie) headers.append("set-cookie", setCookie);
  return headers;
}

async function proxyApiRequest(
  request,
  env,
  {
    fetchImpl = globalThis.fetch,
    cryptoImpl = globalThis.crypto,
  } = {},
) {
  const requestUrl = new URL(request.url);

  if (!API_METHODS.has(request.method)) {
    if (request.method === "OPTIONS" && isSameOriginRequest(request, requestUrl)) {
      return new Response(null, {
        status: 204,
        headers: {
          allow: [...API_METHODS].join(", "),
          "cache-control": "no-store",
        },
      });
    }
    return apiError(405, "METHOD_NOT_ALLOWED", "This API method is not allowed.", {
      allow: [...API_METHODS].join(", "),
    });
  }

  if (!isSameOriginRequest(request, requestUrl)) {
    return apiError(403, "CROSS_ORIGIN_REQUEST_DENIED", "The API only accepts same-origin requests.");
  }

  const config = normalizeProxyConfig(env);
  if (!config) {
    return apiError(
      503,
      "API_PROXY_NOT_CONFIGURED",
      "The trip service is temporarily unavailable.",
      { "retry-after": "60" },
    );
  }

  let session;
  try {
    session = await resolveSession(request, config.sessionSigningKey, cryptoImpl);
  } catch {
    return apiError(
      503,
      "API_PROXY_NOT_CONFIGURED",
      "The trip service is temporarily unavailable.",
      { "retry-after": "60" },
    );
  }

  let body;
  try {
    body = await readRequestBody(request);
  } catch {
    return apiError(413, "PAYLOAD_TOO_LARGE", "The API request body is too large.");
  }

  const upstreamUrl = new URL(requestUrl.pathname + requestUrl.search, config.apiOrigin);
  const upstreamHeaders = buildUpstreamHeaders(request, config, session.userId);
  const upstreamInit = {
    method: request.method,
    headers: upstreamHeaders,
    redirect: "manual",
    signal: request.signal,
  };
  if (body !== undefined) upstreamInit.body = body;

  let upstreamResponse;
  try {
    upstreamResponse = await fetchImpl(upstreamUrl, upstreamInit);
  } catch {
    return apiError(
      502,
      "API_UPSTREAM_UNAVAILABLE",
      "The trip service could not be reached.",
      {
        ...(session.setCookie ? { "set-cookie": session.setCookie } : {}),
        "retry-after": "5",
      },
    );
  }

  return new Response(
    request.method === "HEAD" ? null : upstreamResponse.body,
    {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: buildClientHeaders(upstreamResponse, session.setCookie),
    },
  );
}

export function createSitesWorker({
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
} = {}) {
  return {
    async fetch(request, env) {
      const requestUrl = new URL(request.url);
      if (isApiPath(requestUrl.pathname)) {
        return proxyApiRequest(request, env, { fetchImpl, cryptoImpl });
      }

      const response = await env.ASSETS.fetch(request);
      const acceptsHtml = request.headers.get("accept")?.includes("text/html");

      if (
        response.status !== 404
        || !acceptsHtml
        || !["GET", "HEAD"].includes(request.method)
      ) {
        return response;
      }

      const indexUrl = new URL(request.url);
      indexUrl.pathname = "/index.html";
      indexUrl.search = "";
      return env.ASSETS.fetch(new Request(indexUrl, request));
    },
  };
}

export default createSitesWorker();
