import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.resolve(frontendRoot, "..", "release", "Knot-Offline-Demo.html");

test("emits a self-contained offline demonstration HTML file", async () => {
  await access(outputPath);
  const output = await readFile(outputPath, "utf8");
  const outputStats = await stat(outputPath);

  assert.match(output, /name="knot-demo-mode" content="offline-static"/u);
  assert.match(output, /<style>/u);
  assert.match(output, /<script type="module">/u);
  assert.doesNotMatch(output, /<script[^>]+src=/u);
  assert.doesNotMatch(output, /<link[^>]+rel="stylesheet"/u);
  assert.doesNotMatch(output, /(?:src|href)=["']\.?\/assets\//u);
  assert.match(output, /data:font\/woff2;base64,/u);
  assert.doesNotMatch(output, /url\(\.\/fonts\//u);
  assert.ok(outputStats.size > 1_000_000);
  assert.ok(outputStats.size < 95_000_000);
});
