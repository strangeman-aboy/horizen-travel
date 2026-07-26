const DEFAULT_TILE_SIZE = 256;
const DEFAULT_MIN_TILE_ZOOM = 0;
const DEFAULT_MAX_TILE_ZOOM = 19;

const clamp = (value, minimum, maximum) => (
  Math.min(maximum, Math.max(minimum, value))
);

const assertFiniteNumber = (value, name) => {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
};

const assertPositiveNumber = (value, name) => {
  assertFiniteNumber(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than zero`);
  }
  return value;
};

const assertTileZoom = (value, name) => {
  assertFiniteNumber(value, name);
  if (!Number.isInteger(value) || value < 0 || value > 30) {
    throw new RangeError(`${name} must be an integer from 0 through 30`);
  }
  return value;
};

/**
 * Keep a Web Mercator x coordinate in its repeating [0, 1) world and clamp y
 * to the non-repeating [0, 1] north/south extent.
 */
export function normalizeMercatorCenter(center) {
  const x = assertFiniteNumber(center?.x, "center.x");
  const y = assertFiniteNumber(center?.y, "center.y");

  return {
    x: ((x % 1) + 1) % 1,
    y: clamp(y, 0, 1),
  };
}

/**
 * Convert an unwrapped tile column into the x coordinate accepted by an OSM
 * raster tile URL.
 */
export function wrapRasterTileX(x, tileCount) {
  assertFiniteNumber(x, "x");
  assertPositiveNumber(tileCount, "tileCount");
  return ((Math.trunc(x) % tileCount) + tileCount) % tileCount;
}

/**
 * Clamp a tile row to the finite Web Mercator north/south tile extent.
 */
export function clampRasterTileY(y, tileCount) {
  assertFiniteNumber(y, "y");
  assertPositiveNumber(tileCount, "tileCount");
  return clamp(Math.trunc(y), 0, tileCount - 1);
}

/**
 * Choose one raster source level for a potentially fractional display zoom.
 * Flooring prevents fetching the next (more detailed) level before it is
 * actually needed; clamping respects the source's available tile levels.
 */
export function resolveRasterTileZoom(
  zoom,
  {
    minTileZoom = DEFAULT_MIN_TILE_ZOOM,
    maxTileZoom = DEFAULT_MAX_TILE_ZOOM,
  } = {},
) {
  assertFiniteNumber(zoom, "zoom");
  assertTileZoom(minTileZoom, "minTileZoom");
  assertTileZoom(maxTileZoom, "maxTileZoom");
  if (minTileZoom > maxTileZoom) {
    throw new RangeError("minTileZoom cannot be greater than maxTileZoom");
  }

  return clamp(Math.floor(zoom), minTileZoom, maxTileZoom);
}

/**
 * Return exactly the raster tiles intersecting a viewport at one source zoom.
 *
 * `center` is normalized Web Mercator ({x, y}), not longitude/latitude.
 * Horizontal tile columns remain unwrapped for screen placement while `x` is
 * wrapped for OSM URL use. Vertical rows outside the Mercator world are
 * omitted, so edge tiles are neither duplicated nor requested out of range.
 */
export function calculateVisibleRasterTiles({
  center,
  zoom,
  width,
  height,
  tileSize = DEFAULT_TILE_SIZE,
  minTileZoom = DEFAULT_MIN_TILE_ZOOM,
  maxTileZoom = DEFAULT_MAX_TILE_ZOOM,
}) {
  const normalizedCenter = normalizeMercatorCenter(center);
  assertFiniteNumber(zoom, "zoom");
  assertPositiveNumber(width, "width");
  assertPositiveNumber(height, "height");
  assertPositiveNumber(tileSize, "tileSize");

  const tileZoom = resolveRasterTileZoom(zoom, {
    minTileZoom,
    maxTileZoom,
  });
  const tileCount = 2 ** tileZoom;
  const renderedTileSize = tileSize * 2 ** (zoom - tileZoom);
  const centerTileX = normalizedCenter.x * tileCount;
  const centerTileY = normalizedCenter.y * tileCount;

  const firstWorldX = Math.floor(centerTileX - width / (2 * renderedTileSize));
  const lastWorldX = Math.ceil(centerTileX + width / (2 * renderedTileSize)) - 1;
  const firstY = clampRasterTileY(
    Math.floor(centerTileY - height / (2 * renderedTileSize)),
    tileCount,
  );
  const lastY = clampRasterTileY(
    Math.ceil(centerTileY + height / (2 * renderedTileSize)) - 1,
    tileCount,
  );

  const tiles = [];

  for (let y = firstY; y <= lastY; y += 1) {
    const top = height / 2 + (y - centerTileY) * renderedTileSize;

    // A clamped range can point at an edge tile even when the viewport lies
    // wholly outside it. This strict intersection check keeps the result free
    // of non-visible prefetches.
    if (top >= height || top + renderedTileSize <= 0) continue;

    for (let worldX = firstWorldX; worldX <= lastWorldX; worldX += 1) {
      const left = width / 2 + (worldX - centerTileX) * renderedTileSize;
      if (left >= width || left + renderedTileSize <= 0) continue;

      const x = wrapRasterTileX(worldX, tileCount);
      const url = Object.freeze({ z: tileZoom, x, y });

      tiles.push({
        key: `${tileZoom}/${worldX}/${y}`,
        z: tileZoom,
        x,
        y,
        worldX,
        url,
        urlPath: `${tileZoom}/${x}/${y}.png`,
        left,
        top,
        size: renderedTileSize,
      });
    }
  }

  return {
    center: normalizedCenter,
    zoom,
    tileZoom,
    tileCount,
    renderedTileSize,
    width,
    height,
    tiles,
  };
}

export {
  DEFAULT_MAX_TILE_ZOOM,
  DEFAULT_MIN_TILE_ZOOM,
  DEFAULT_TILE_SIZE,
};
