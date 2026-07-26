import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const SUPPORTED_HOSTS = new Set([
  "xiaohongshu.com",
  "www.xiaohongshu.com",
  "xhslink.com",
  "www.xhslink.com"
]);

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function fallback(fallbackCode, resolvedUrl = null) {
  return {
    metadataStatus: "FALLBACK",
    fallbackCode,
    resolvedUrl,
    title: null,
    description: null,
    authorName: null
  };
}

function normalizeHostname(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\.$/, "");
}

export function normalizeXiaohongshuUrl(value, baseUrl = undefined) {
  let parsed;
  try {
    parsed = baseUrl ? new URL(value, baseUrl) : new URL(value);
  } catch {
    return null;
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    isIP(hostname) !== 0 ||
    !SUPPORTED_HOSTS.has(hostname)
  ) {
    return null;
  }

  parsed.hostname = hostname;
  parsed.hash = "";
  return parsed;
}

function parseIpv4(address) {
  const octets = String(address).split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return octets;
}

function isPublicIpv4(address) {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 0 && octets[2] === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && octets[2] === 100) return false;
  if (a === 203 && b === 0 && octets[2] === 113) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(address) {
  const normalized = String(address).toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:")) {
    return isPublicIpv4(normalized.slice("::ffff:".length));
  }
  if (normalized === "::" || normalized === "::1") return false;
  if (/^(?:fc|fd)/.test(normalized)) return false;
  if (/^fe[89ab]/.test(normalized)) return false;
  if (normalized.startsWith("ff")) return false;
  if (normalized.startsWith("2001:db8")) return false;
  return true;
}

export function isPublicAddress(address) {
  const family = isIP(String(address));
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

async function assertPublicDns(hostname, lookupImpl) {
  const records = await lookupImpl(hostname, { all: true, verbatim: true });
  if (
    !Array.isArray(records) ||
    records.length === 0 ||
    records.some((record) => !isPublicAddress(record.address))
  ) {
    const error = new Error("The source host did not resolve exclusively to public addresses.");
    error.code = "UNSAFE_DNS";
    throw error;
  }
}

function decodeHtmlEntities(value) {
  const decodeCodePoint = (original, raw, radix) => {
    const codePoint = Number.parseInt(raw, radix);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return original;
    }
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return original;
    }
  };
  return String(value ?? "")
    .replace(/&#(\d+);/g, (original, code) => decodeCodePoint(original, code, 10))
    .replace(/&#x([\da-f]+);/gi, (original, code) => decodeCodePoint(original, code, 16))
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ");
}

function cleanText(value, maxLength) {
  const text = decodeHtmlEntities(value)
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, maxLength) : null;
}

function parseAttributes(tag) {
  const attributes = {};
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;
  while ((match = pattern.exec(tag))) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

export function extractPublicMetadata(html, resolvedUrl) {
  const source = String(html ?? "");
  const metadata = new Map();
  for (const match of source.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const key = String(attributes.property ?? attributes.name ?? "").toLowerCase();
    if (key && attributes.content && !metadata.has(key)) {
      metadata.set(key, attributes.content);
    }
  }

  const titleTag = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = cleanText(
    metadata.get("og:title") ?? metadata.get("twitter:title") ?? titleTag,
    160
  );
  const description = cleanText(
    metadata.get("og:description") ??
      metadata.get("description") ??
      metadata.get("twitter:description"),
    500
  );
  const authorName = cleanText(
    metadata.get("author") ?? metadata.get("article:author"),
    100
  );

  let canonicalUrl = null;
  for (const match of source.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const relationships = String(attributes.rel ?? "").toLowerCase().split(/\s+/);
    if (!relationships.includes("canonical") || !attributes.href) continue;
    canonicalUrl = normalizeXiaohongshuUrl(attributes.href, resolvedUrl)?.toString() ?? null;
    if (canonicalUrl) break;
  }

  return {
    title,
    description,
    authorName,
    resolvedUrl: canonicalUrl ?? resolvedUrl
  };
}

async function readHeadHtml(response, maxBytes) {
  if (!response.body?.getReader) {
    const error = new Error("The response did not expose a readable body.");
    error.code = "BODY_UNAVAILABLE";
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let byteCount = 0;
  let html = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > maxBytes) {
        const error = new Error("The public page exceeded the metadata byte limit.");
        error.code = "TOO_LARGE";
        throw error;
      }
      html += decoder.decode(value, { stream: true });
      if (/<\/head\s*>/i.test(html)) break;
    }
    html += decoder.decode();
    return html;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed.
    }
  }
}

function mapFallbackCode(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "TIMEOUT";
  if (error?.code === "UNSAFE_DNS") return "UNSAFE_REDIRECT";
  if (error?.code === "TOO_LARGE") return "TOO_LARGE";
  if (error?.code === "UNSUPPORTED_REDIRECT") return "UNSAFE_REDIRECT";
  return "NETWORK_UNAVAILABLE";
}

export function createXiaohongshuMetadataResolver({
  fetchImpl = globalThis.fetch,
  lookupImpl = dnsLookup,
  timeoutMs = 3_500,
  maxBytes = 524_288,
  maxRedirects = 3,
  logger = null
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }

  return async function resolveXiaohongshuMetadata(shareUrl) {
    let current = normalizeXiaohongshuUrl(shareUrl);
    if (!current) return fallback("UNSUPPORTED_URL");
    const signal = AbortSignal.timeout(timeoutMs);

    try {
      for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        await assertPublicDns(current.hostname, lookupImpl);
        const response = await fetchImpl(current, {
          method: "GET",
          redirect: "manual",
          signal,
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "zh-CN,zh;q=0.9",
            Range: `bytes=0-${maxBytes - 1}`,
            "User-Agent": "RouteStoryHackathonPreview/0.2"
          }
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          const nextUrl = location
            ? normalizeXiaohongshuUrl(location, current)
            : null;
          if (!nextUrl || redirectCount === maxRedirects) {
            const error = new Error("The source redirected outside the supported public hosts.");
            error.code = "UNSUPPORTED_REDIRECT";
            throw error;
          }
          current = nextUrl;
          continue;
        }

        if (!response.ok) {
          return fallback(`HTTP_${response.status}`, current.toString());
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (
          !contentType.startsWith("text/html") &&
          !contentType.startsWith("application/xhtml+xml")
        ) {
          return fallback("UNSUPPORTED_CONTENT_TYPE", current.toString());
        }

        const html = await readHeadHtml(response, maxBytes);
        const metadata = extractPublicMetadata(html, current.toString());
        const looksUnavailable = /页面不见了|安全验证|访问验证|登录小红书/u.test(
          metadata.title ?? ""
        );
        const genericTitle = /^(?:小红书\s*-\s*你的生活指南|小红书)$/u.test(
          metadata.title ?? ""
        );
        if ((!metadata.title && !metadata.description) || looksUnavailable || genericTitle) {
          return fallback("METADATA_MISSING", metadata.resolvedUrl);
        }

        return {
          metadataStatus: "PUBLIC_METADATA",
          fallbackCode: null,
          ...metadata
        };
      }
      return fallback("REDIRECT_LIMIT", current.toString());
    } catch (error) {
      logger?.info?.({
        event: "xiaohongshu_public_metadata_fallback",
        hostname: current.hostname,
        fallbackCode: mapFallbackCode(error)
      });
      return fallback(mapFallbackCode(error), current.toString());
    }
  };
}
