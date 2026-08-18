#!/usr/bin/env node

import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(frontendRoot, "..");
const sourceRoot = path.join(frontendRoot, "dist-static");
const sourceHtmlPath = path.join(sourceRoot, "index.html");
const releaseRoot = path.join(projectRoot, "release");
const outputPath = path.join(releaseRoot, "Knot-Offline-Demo.html");

const mimeTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
]);

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function toDataUrl(filePath, bytes) {
  const mime = mimeTypes.get(path.extname(filePath).toLowerCase());
  if (!mime) return null;
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function escapeInlineScript(source) {
  return source.replaceAll(/<\/script/giu, "<\\/script");
}

function escapeInlineStyle(source) {
  return source.replaceAll(/<\/style/giu, "<\\/style");
}

const sourceHtml = await readFile(sourceHtmlPath, "utf8");
const scriptMatch = sourceHtml.match(
  /<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/u,
);
const styleMatch = sourceHtml.match(
  /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/u,
);

if (!scriptMatch || !styleMatch) {
  throw new Error("Static demo build could not locate the Vite JavaScript and CSS assets.");
}

const scriptPath = path.resolve(sourceRoot, scriptMatch[1]);
const stylePath = path.resolve(sourceRoot, styleMatch[1]);
let script = await readFile(scriptPath, "utf8");
let style = await readFile(stylePath, "utf8");

const publicAssetsRoot = path.join(sourceRoot, "assets");
const assetFiles = await walkFiles(publicAssetsRoot);
const scriptAssetRegistry = {};
let embeddedAssetCount = 0;

for (const assetPath of assetFiles) {
  if ([scriptPath, stylePath].includes(assetPath)) continue;
  const relativePath = path.relative(publicAssetsRoot, assetPath).split(path.sep).join("/");
  const bytes = await readFile(assetPath);
  const dataUrl = toDataUrl(assetPath, bytes);
  if (!dataUrl) continue;

  const absoluteReference = `/assets/${relativePath}`;
  const relativeReference = `./assets/${relativePath}`;
  const parentReference = `../assets/${relativePath}`;
  const stylesheetRelativeReference = `./${relativePath}`;
  let scriptReferenced = false;
  const beforeStyle = style;
  const registryExpression = `__KNOT_OFFLINE_ASSETS__[${JSON.stringify(relativePath)}]`;

  for (const reference of [parentReference, relativeReference, absoluteReference]) {
    for (const quote of ["\"", "'"]) {
      const quotedReference = `${quote}${reference}${quote}`;
      if (script.includes(quotedReference)) {
        script = script.replaceAll(quotedReference, registryExpression);
        scriptReferenced = true;
      }
    }
    style = style.replaceAll(reference, dataUrl);
  }
  // Vite keeps unresolved public font URLs relative to the emitted stylesheet
  // (for example "./fonts/..."). Inline those too so the one-file demo does
  // not silently fall back to a different system font on another computer.
  style = style.replaceAll(stylesheetRelativeReference, dataUrl);

  if (scriptReferenced) scriptAssetRegistry[relativePath] = dataUrl;
  if (scriptReferenced || beforeStyle !== style) embeddedAssetCount += 1;
}

const unresolvedAssetPaths = assetFiles
  .filter((assetPath) => ![scriptPath, stylePath].includes(assetPath))
  .map((assetPath) => path.relative(publicAssetsRoot, assetPath).split(path.sep).join("/"))
  .filter((relativePath) => (
    script.includes(`/assets/${relativePath}`)
    || script.includes(`./assets/${relativePath}`)
    || script.includes(`../assets/${relativePath}`)
    || style.includes(`/assets/${relativePath}`)
    || style.includes(`./assets/${relativePath}`)
    || style.includes(`../assets/${relativePath}`)
    || style.includes(`./${relativePath}`)
  ));

if (unresolvedAssetPaths.length > 0) {
  throw new Error(
    `Static demo could not inline these asset references: ${unresolvedAssetPaths.join(", ")}`,
  );
}

script = [
  `const __KNOT_OFFLINE_ASSETS__ = Object.freeze(${JSON.stringify(scriptAssetRegistry)});`,
  script,
].join("\n");

let outputHtml = sourceHtml
  .replace(styleMatch[0], () => `<style>${escapeInlineStyle(style)}</style>`)
  .replace(scriptMatch[0], () => `<script type="module">${escapeInlineScript(script)}</script>`)
  .replace(
    "</head>",
    () => [
      "  <meta name=\"knot-demo-mode\" content=\"offline-static\">",
      "  <!-- 串 Knot 一文件离线演示版：无需后端或公网。 -->",
      "</head>",
    ].join("\n"),
  );

const unresolvedPattern = /(?:src|href)=["']\.?\/assets\//gu;
const unresolvedReferences = [...outputHtml.matchAll(unresolvedPattern)];
if (unresolvedReferences.length > 0) {
  const contexts = unresolvedReferences.map((match) => (
    outputHtml.slice(Math.max(0, match.index - 80), match.index + 120)
  ));
  throw new Error(
    `Static demo still contains ${unresolvedReferences.length} external asset references:\n`
    + contexts.join("\n---\n"),
  );
}

await mkdir(releaseRoot, { recursive: true });
await writeFile(outputPath, outputHtml, "utf8");

const outputStats = await stat(outputPath);
console.log(
  `Prepared offline demo: ${outputPath} `
  + `(${embeddedAssetCount} embedded assets, ${(outputStats.size / 1024 / 1024).toFixed(2)} MB)`,
);
