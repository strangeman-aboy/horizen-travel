const DEFAULT_CENTER = Object.freeze({ lat: 39.925, lng: 116.404 });
const DEFAULT_ZOOM = 13;
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;
const TILE_SIZE = 256;
const BAIDU_COORD_SYSTEM_PATTERN = /^(BD[-_]?09(?:LL)?)$/i;

const DEMO_BOUNDS = Object.freeze({
  west: 116.37,
  east: 116.445,
  north: 39.96,
  south: 39.895,
});

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const finiteNumber = (value) => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const percentNumber = (value) => {
  const parsed = finiteNumber(value);
  return parsed === null ? null : clamp(parsed, 0, 100);
};

const routeEntryId = (entry) => {
  if (entry && typeof entry === "object") {
    return entry.stopId ?? entry.placeId ?? entry.id ?? entry.clientStopId;
  }
  return entry;
};

const stableId = (value) => String(value);

/**
 * Accept the coordinate shapes currently used by both the frontend and API:
 * {lat, lng}, {latitude, longitude}, {location:{lat,lng}} or
 * GeoJSON-like coordinates [lng, lat].
 */
export function readPlaceCoordinates(place) {
  const coordinatePair = Array.isArray(place?.coordinates)
    ? place.coordinates
    : Array.isArray(place?.location?.coordinates)
      ? place.location.coordinates
      : null;

  const lat = finiteNumber(
    place?.lat
      ?? place?.latitude
      ?? place?.location?.lat
      ?? place?.location?.latitude
      ?? coordinatePair?.[1],
  );
  const lng = finiteNumber(
    place?.lng
      ?? place?.lon
      ?? place?.longitude
      ?? place?.location?.lng
      ?? place?.location?.lon
      ?? place?.location?.longitude
      ?? coordinatePair?.[0],
  );

  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  return { lat, lng };
}

export function hasVerifiedPlaceCoordinates(place) {
  if (!readPlaceCoordinates(place)) return false;

  const coordinateSystem = [
    place?.coordSystem,
    place?.coordinateSystem,
    place?.location?.coordSystem,
    place?.location?.coordinateSystem,
  ].filter(Boolean).join(" ");

  if (!coordinateSystem) return true;
  return BAIDU_COORD_SYSTEM_PATTERN.test(coordinateSystem.trim());
}

function demoCoordinates(place, index, total) {
  const left = percentNumber(place?.position?.left);
  const top = percentNumber(place?.position?.top);

  if (left !== null && top !== null) {
    return {
      lat: DEMO_BOUNDS.north - ((DEMO_BOUNDS.north - DEMO_BOUNDS.south) * top) / 100,
      lng: DEMO_BOUNDS.west + ((DEMO_BOUNDS.east - DEMO_BOUNDS.west) * left) / 100,
    };
  }

  const count = Math.max(total, 1);
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  const ring = 0.008 + Math.floor(index / 8) * 0.004;
  return {
    lat: DEFAULT_CENTER.lat + Math.sin(angle) * ring,
    lng: DEFAULT_CENTER.lng + Math.cos(angle) * ring * 1.3,
  };
}

/**
 * Normalize and order route stops without mutating caller-owned data.
 * Places with no coordinates receive an explicitly approximate demo position
 * so an unfinished itinerary can still be manipulated in the hackathon UI.
 */
export function normalizeMapPlaces(places = [], routeOrder = []) {
  const source = Array.isArray(places) ? places.filter(Boolean) : [];
  const byId = new Map(source.map((place, index) => [
    stableId(place.id ?? place.stopId ?? place.placeId ?? `map-place-${index + 1}`),
    { place, sourceIndex: index },
  ]));

  const ordered = [];
  const used = new Set();

  if (Array.isArray(routeOrder)) {
    routeOrder.forEach((entry) => {
      const rawId = routeEntryId(entry);
      if (rawId === undefined || rawId === null) return;
      const key = stableId(rawId);
      const match = byId.get(key);
      if (!match || used.has(key)) return;
      ordered.push(match);
      used.add(key);
    });
  }

  source.forEach((place, index) => {
    const key = stableId(place.id ?? place.stopId ?? place.placeId ?? `map-place-${index + 1}`);
    if (!used.has(key)) {
      ordered.push({ place, sourceIndex: index });
      used.add(key);
    }
  });

  return ordered.map(({ place, sourceIndex }, routeIndex) => {
    const id = place.id ?? place.stopId ?? place.placeId ?? `map-place-${sourceIndex + 1}`;
    const coordinates = readPlaceCoordinates(place);
    const hasVerifiedCoordinates = hasVerifiedPlaceCoordinates(place);
    const fallback = coordinates ?? demoCoordinates(place, routeIndex, ordered.length);

    return {
      ...place,
      id,
      name: place.name ?? place.title ?? `地点 ${routeIndex + 1}`,
      address: place.address ?? place.subtitle ?? "",
      lat: fallback.lat,
      lng: fallback.lng,
      routeIndex,
      hasVerifiedCoordinates,
    };
  });
}

export function lngLatToWorld({ lat, lng }) {
  const safeLatitude = clamp(lat, -85.05112878, 85.05112878);
  const sinLatitude = Math.sin((safeLatitude * Math.PI) / 180);
  return {
    x: (lng + 180) / 360,
    y: 0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI),
  };
}

export function worldToLngLat({ x, y }) {
  const lng = x * 360 - 180;
  const mercator = Math.PI - 2 * Math.PI * y;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(mercator));
  return { lat, lng };
}

export function projectToScreen(point, viewport) {
  const world = lngLatToWorld(point);
  const centerWorld = lngLatToWorld(viewport.center);
  const scale = TILE_SIZE * 2 ** viewport.zoom;

  return {
    x: viewport.width / 2 + (world.x - centerWorld.x) * scale,
    y: viewport.height / 2 + (world.y - centerWorld.y) * scale,
  };
}

export function screenToLngLat(screenPoint, viewport) {
  const centerWorld = lngLatToWorld(viewport.center);
  const scale = TILE_SIZE * 2 ** viewport.zoom;
  return worldToLngLat({
    x: centerWorld.x + (screenPoint.x - viewport.width / 2) / scale,
    y: centerWorld.y + (screenPoint.y - viewport.height / 2) / scale,
  });
}

export function fitMapViewport(points = [], width = 720, height = 420, padding = 64) {
  const validPoints = points.filter((point) => (
    Number.isFinite(point?.lat)
    && Number.isFinite(point?.lng)
    && Math.abs(point.lat) <= 90
    && Math.abs(point.lng) <= 180
  ));

  if (validPoints.length === 0) {
    return { center: { ...DEFAULT_CENTER }, zoom: DEFAULT_ZOOM };
  }

  if (validPoints.length === 1) {
    return {
      center: { lat: validPoints[0].lat, lng: validPoints[0].lng },
      zoom: 15,
    };
  }

  const worlds = validPoints.map(lngLatToWorld);
  const minimumX = Math.min(...worlds.map((point) => point.x));
  const maximumX = Math.max(...worlds.map((point) => point.x));
  const minimumY = Math.min(...worlds.map((point) => point.y));
  const maximumY = Math.max(...worlds.map((point) => point.y));
  const availableWidth = Math.max(80, width - padding * 2);
  const availableHeight = Math.max(80, height - padding * 2);
  const spanX = Math.max(maximumX - minimumX, 1 / 2 ** 24);
  const spanY = Math.max(maximumY - minimumY, 1 / 2 ** 24);
  const zoomX = Math.log2(availableWidth / (TILE_SIZE * spanX));
  const zoomY = Math.log2(availableHeight / (TILE_SIZE * spanY));
  const centerWorld = {
    x: (minimumX + maximumX) / 2,
    y: (minimumY + maximumY) / 2,
  };

  return {
    center: worldToLngLat(centerWorld),
    zoom: clamp(Math.min(zoomX, zoomY, MAX_ZOOM), MIN_ZOOM, MAX_ZOOM),
  };
}

export function clampMapZoom(zoom) {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

export {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  DEMO_BOUNDS,
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_SIZE,
};
