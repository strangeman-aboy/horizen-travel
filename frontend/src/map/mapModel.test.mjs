import assert from "node:assert/strict";
import test from "node:test";
import {
  fitMapViewport,
  hasVerifiedPlaceCoordinates,
  normalizeMapPlaces,
  readPlaceCoordinates,
} from "./mapModel.js";

test("reads both API and legacy coordinate shapes", () => {
  assert.deepEqual(readPlaceCoordinates({ lat: 39.9, lng: 116.4 }), {
    lat: 39.9,
    lng: 116.4,
  });
  assert.deepEqual(readPlaceCoordinates({ latitude: 31.2, longitude: 121.5 }), {
    lat: 31.2,
    lng: 121.5,
  });
  assert.deepEqual(readPlaceCoordinates({ coordinates: [116.38, 39.91] }), {
    lat: 39.91,
    lng: 116.38,
  });
});

test("orders stops by route order and marks generated demo coordinates", () => {
  const places = [
    { id: 1, name: "第一站", position: { left: "20%", top: "30%" } },
    { id: 2, name: "第二站", lat: 39.95, lng: 116.41 },
  ];
  const result = normalizeMapPlaces(places, [{ stopId: 2 }, { stopId: 1 }]);

  assert.deepEqual(result.map((place) => place.id), [2, 1]);
  assert.equal(result[0].hasVerifiedCoordinates, true);
  assert.equal(result[1].hasVerifiedCoordinates, false);
  assert.ok(Number.isFinite(result[1].lat));
  assert.ok(Number.isFinite(result[1].lng));
});

test("treats explicitly mocked coordinates as geocoding candidates", () => {
  const mocked = {
    id: 1,
    name: "雍和宫",
    latitude: 39.9475,
    longitude: 116.4173,
    coordSystem: "BD09_MOCK",
  };
  const verified = {
    id: 2,
    name: "景山公园",
    latitude: 39.93227,
    longitude: 116.40282,
    coordSystem: "BD09",
  };

  assert.equal(hasVerifiedPlaceCoordinates(mocked), false);
  assert.equal(hasVerifiedPlaceCoordinates(verified), true);
  assert.equal(hasVerifiedPlaceCoordinates({
    ...verified,
    coordSystem: "GCJ02",
  }), false);
  assert.equal(hasVerifiedPlaceCoordinates({
    ...verified,
    coordSystem: "WGS84",
  }), false);
  assert.equal(normalizeMapPlaces([mocked])[0].hasVerifiedCoordinates, false);
  assert.equal(normalizeMapPlaces([verified])[0].hasVerifiedCoordinates, true);
});

test("fits a Beijing route into a practical city zoom", () => {
  const viewport = fitMapViewport([
    { lat: 39.9475, lng: 116.4173 },
    { lat: 39.9235, lng: 116.3969 },
    { lat: 39.9371, lng: 116.3854 },
  ], 800, 420);

  assert.ok(viewport.center.lat > 39.92 && viewport.center.lat < 39.95);
  assert.ok(viewport.center.lng > 116.38 && viewport.center.lng < 116.42);
  assert.ok(viewport.zoom >= 12 && viewport.zoom <= 16);
});
