import { normalizeAttractionName } from "./personalizedRouteGenerator.js";

/**
 * Prototype personality annotations for the eight verified Beijing places
 * already bundled with Knot. These editorial scores only drive the local
 * deterministic demo; they are not presented as scientific or live facts.
 * Each opposing pair uses the same 1-10 style scale as the source algorithm.
 */
export const BEIJING_ATTRACTION_PROFILES = Object.freeze([
  Object.freeze({
    name: "雍和宫",
    city: "北京",
    level: "成熟",
    scores: Object.freeze({ A: 5, R: 6, N: 4, F: 7, G: 5, S: 6, P: 7, W: 4 }),
  }),
  Object.freeze({
    name: "五道营胡同",
    city: "北京",
    level: "成熟",
    scores: Object.freeze({ A: 6, R: 5, N: 8, F: 3, G: 7, S: 4, P: 4, W: 7 }),
  }),
  Object.freeze({
    name: "国子监街",
    city: "北京",
    level: "成熟",
    scores: Object.freeze({ A: 4, R: 7, N: 4, F: 7, G: 4, S: 7, P: 7, W: 4 }),
  }),
  Object.freeze({
    name: "东四艺文街区",
    city: "北京",
    level: "成熟",
    scores: Object.freeze({ A: 6, R: 5, N: 8, F: 3, G: 6, S: 5, P: 5, W: 6 }),
  }),
  Object.freeze({
    name: "景山公园",
    city: "北京",
    level: "成熟",
    scores: Object.freeze({ A: 7, R: 4, N: 6, F: 5, G: 4, S: 7, P: 6, W: 5 }),
  }),
  Object.freeze({
    name: "什刹海",
    city: "北京",
    level: "成熟",
    scores: Object.freeze({ A: 6, R: 5, N: 5, F: 6, G: 8, S: 3, P: 3, W: 8 }),
  }),
  Object.freeze({
    name: "故宫博物院",
    city: "北京",
    level: "成熟",
    scores: Object.freeze({ A: 4, R: 7, N: 3, F: 8, G: 6, S: 5, P: 9, W: 2 }),
  }),
  Object.freeze({
    name: "钟鼓楼胡同",
    city: "北京",
    level: "成熟",
    scores: Object.freeze({ A: 6, R: 5, N: 6, F: 5, G: 6, S: 5, P: 4, W: 7 }),
  }),
]);

const profileByName = new Map(
  BEIJING_ATTRACTION_PROFILES.map((profile) => [normalizeAttractionName(profile.name), profile]),
);

/**
 * Joins the current application place objects with their personality scores.
 * Unannotated places are deliberately omitted instead of receiving invented
 * neutral scores.
 */
export function buildBeijingPersonalityAttractions(places = []) {
  if (!Array.isArray(places)) return [];
  return places.flatMap((place) => {
    const profile = profileByName.get(normalizeAttractionName(place?.name));
    const lon = Number(place?.longitude ?? place?.lng ?? place?.lon);
    const lat = Number(place?.latitude ?? place?.lat);
    if (!profile || !Number.isFinite(lon) || !Number.isFinite(lat)) return [];
    return [{
      ...profile,
      id: place.id,
      name: place.name,
      lon,
      lat,
      source: place,
    }];
  });
}
