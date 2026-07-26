import assert from "node:assert/strict";
import test from "node:test";
import {
  createXiaohongshuMetadataResolver,
  extractPublicMetadata,
  isPublicAddress,
  normalizeXiaohongshuUrl
} from "../src/xiaohongshu-metadata.js";

const publicLookup = async () => [{ address: "203.0.114.20", family: 4 }];

test("normalizes only official HTTPS Xiaohongshu share hosts", () => {
  assert.equal(
    normalizeXiaohongshuUrl(
      "https://www.xiaohongshu.com/explore/note-123#comments"
    )?.toString(),
    "https://www.xiaohongshu.com/explore/note-123"
  );
  assert.equal(normalizeXiaohongshuUrl("https://example.com/note"), null);
  assert.equal(normalizeXiaohongshuUrl("https://127.0.0.1/note"), null);
  assert.equal(normalizeXiaohongshuUrl("https://user@xhslink.com/a/demo"), null);
  assert.equal(normalizeXiaohongshuUrl("https://xhslink.com:444/a/demo"), null);
});

test("rejects private and reserved DNS results", () => {
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("10.1.2.3"), false);
  assert.equal(isPublicAddress("169.254.169.254"), false);
  assert.equal(isPublicAddress("::1"), false);
  assert.equal(isPublicAddress("fc00::1"), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("extracts inert public metadata without copying markup", () => {
  const metadata = extractPublicMetadata(`
    <html>
      <head>
        <meta content="北京胡同 Citywalk &amp; 咖啡" property="og:title">
        <meta name="description" content="雍和宫到五道营的半日路线">
        <meta content="散步者" name="author">
        <link href="/explore/note-123" rel="canonical">
        <script>throw new Error("must not execute")</script>
      </head>
    </html>
  `, "https://www.xiaohongshu.com/explore/note-123?token=demo");

  assert.deepEqual(metadata, {
    title: "北京胡同 Citywalk & 咖啡",
    description: "雍和宫到五道营的半日路线",
    authorName: "散步者",
    resolvedUrl: "https://www.xiaohongshu.com/explore/note-123"
  });
});

test("follows supported redirects and returns public title metadata", async () => {
  const requests = [];
  const resolver = createXiaohongshuMetadataResolver({
    lookupImpl: publicLookup,
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      if (requests.length === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://www.xiaohongshu.com/explore/note-123"
          }
        });
      }
      return new Response(`
        <head>
          <title>北京胡同一日路线 - 小红书</title>
          <meta name="description" content="从雍和宫慢慢走到什刹海">
        </head>
      `, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
  });

  const result = await resolver("https://xhslink.com/a/demo");
  assert.equal(result.metadataStatus, "PUBLIC_METADATA");
  assert.equal(result.title, "北京胡同一日路线 - 小红书");
  assert.equal(result.description, "从雍和宫慢慢走到什刹海");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.redirect, "manual");
  assert.equal(requests[0].options.headers.Authorization, undefined);
});

test("dangerous redirects and network failures become stable fallbacks", async () => {
  const unsafeRedirect = createXiaohongshuMetadataResolver({
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1/private" }
    })
  });
  const unsafeResult = await unsafeRedirect("https://xhslink.com/a/demo");
  assert.equal(unsafeResult.metadataStatus, "FALLBACK");
  assert.equal(unsafeResult.fallbackCode, "UNSAFE_REDIRECT");

  const unavailable = createXiaohongshuMetadataResolver({
    lookupImpl: publicLookup,
    fetchImpl: async () => {
      throw new TypeError("simulated connection failure");
    }
  });
  const unavailableResult = await unavailable("https://xhslink.com/a/demo");
  assert.equal(unavailableResult.metadataStatus, "FALLBACK");
  assert.equal(unavailableResult.fallbackCode, "NETWORK_UNAVAILABLE");
});
