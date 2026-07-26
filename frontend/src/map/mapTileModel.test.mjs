import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateVisibleRasterTiles,
  clampRasterTileY,
  normalizeMercatorCenter,
  resolveRasterTileZoom,
  wrapRasterTileX,
} from "./mapTileModel.js";

const almostEqual = (actual, expected, epsilon = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

test("normalizes the repeating x axis and clamps the finite y axis", () => {
  assert.deepEqual(normalizeMercatorCenter({ x: 1.25, y: -0.4 }), {
    x: 0.25,
    y: 0,
  });
  assert.deepEqual(normalizeMercatorCenter({ x: -0.25, y: 1.4 }), {
    x: 0.75,
    y: 1,
  });
});

test("wraps URL columns and clamps URL rows at both world edges", () => {
  assert.equal(wrapRasterTileX(-1, 4), 3);
  assert.equal(wrapRasterTileX(4, 4), 0);
  assert.equal(clampRasterTileY(-1, 4), 0);
  assert.equal(clampRasterTileY(4, 4), 3);
});

test("uses one floored source level for fractional zoom", () => {
  const viewport = calculateVisibleRasterTiles({
    center: { x: 0.625, y: 0.625 },
    zoom: 2.5,
    width: 256,
    height: 256,
  });

  assert.equal(viewport.tileZoom, 2);
  almostEqual(viewport.renderedTileSize, 256 * Math.SQRT2);
  assert.deepEqual(new Set(viewport.tiles.map((tile) => tile.z)), new Set([2]));
  assert.equal(viewport.tiles.length, 1);
  assert.deepEqual(viewport.tiles[0].url, { z: 2, x: 2, y: 2 });
  assert.equal(viewport.tiles[0].urlPath, "2/2/2.png");
  almostEqual(viewport.tiles[0].left, (256 - 256 * Math.SQRT2) / 2);
  almostEqual(viewport.tiles[0].top, (256 - 256 * Math.SQRT2) / 2);
  almostEqual(viewport.tiles[0].size, 256 * Math.SQRT2);
});

test("does not fetch tiles touching only an exact viewport boundary", () => {
  const viewport = calculateVisibleRasterTiles({
    // The center of z=2 tile 2/2.
    center: { x: 2.5 / 4, y: 2.5 / 4 },
    zoom: 2,
    width: 256,
    height: 256,
  });

  assert.equal(viewport.tiles.length, 1);
  assert.deepEqual(viewport.tiles[0].url, { z: 2, x: 2, y: 2 });
  assert.equal(viewport.tiles[0].left, 0);
  assert.equal(viewport.tiles[0].top, 0);
  assert.equal(viewport.tiles[0].size, 256);
});

test("wraps x URL coordinates while preserving unwrapped screen columns", () => {
  const viewport = calculateVisibleRasterTiles({
    center: { x: 0.01, y: 0.625 },
    zoom: 2,
    width: 512,
    height: 128,
  });

  assert.deepEqual(
    viewport.tiles.map(({ worldX, x, y }) => ({ worldX, x, y })),
    [
      { worldX: -1, x: 3, y: 2 },
      { worldX: 0, x: 0, y: 2 },
      { worldX: 1, x: 1, y: 2 },
    ],
  );
  almostEqual(
    viewport.tiles[1].left - viewport.tiles[0].left,
    viewport.renderedTileSize,
  );
  almostEqual(
    viewport.tiles[2].left - viewport.tiles[1].left,
    viewport.renderedTileSize,
  );
});

test("omits y rows beyond the north and south Mercator edges", () => {
  const north = calculateVisibleRasterTiles({
    center: { x: 0.625, y: -1 },
    zoom: 2,
    width: 64,
    height: 512,
  });
  const south = calculateVisibleRasterTiles({
    center: { x: 0.625, y: 2 },
    zoom: 2,
    width: 64,
    height: 512,
  });

  assert.deepEqual([...new Set(north.tiles.map((tile) => tile.y))], [0]);
  assert.deepEqual([...new Set(south.tiles.map((tile) => tile.y))], [3]);
  assert.ok(north.tiles.every((tile) => tile.top < north.height));
  assert.ok(south.tiles.every((tile) => tile.top + tile.size > 0));
});

test("clamps source zoom without prefetching adjacent levels", () => {
  assert.equal(resolveRasterTileZoom(-2.25, { minTileZoom: 0, maxTileZoom: 19 }), 0);
  assert.equal(resolveRasterTileZoom(22.75, { minTileZoom: 0, maxTileZoom: 19 }), 19);

  const viewport = calculateVisibleRasterTiles({
    center: { x: 0.5, y: 0.5 },
    zoom: 20.5,
    width: 800,
    height: 500,
    maxTileZoom: 19,
  });

  assert.equal(viewport.tileZoom, 19);
  assert.deepEqual([...new Set(viewport.tiles.map((tile) => tile.z))], [19]);
  almostEqual(viewport.renderedTileSize, 256 * 2 ** 1.5);
});

test("returns only tiles with a positive-area viewport intersection", () => {
  const viewport = calculateVisibleRasterTiles({
    center: { x: 0.42, y: 0.38 },
    zoom: 5.25,
    width: 731,
    height: 417,
  });

  assert.ok(viewport.tiles.length > 0);
  for (const tile of viewport.tiles) {
    assert.ok(tile.left < viewport.width);
    assert.ok(tile.left + tile.size > 0);
    assert.ok(tile.top < viewport.height);
    assert.ok(tile.top + tile.size > 0);
    assert.equal(tile.z, viewport.tileZoom);
  }
});
