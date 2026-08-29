import assert from "node:assert/strict";
import test from "node:test";

import {
  DIALECT_PERSONALITIES,
  DIALECT_PERSONALITY_DIMENSIONS,
  computeDialectPersonality,
  createDialectQuestionSequence,
  getDialectPersonalityQuestion,
} from "../src/personality/dialectPersonalityModel.js";
import {
  BEIJING_ATTRACTION_PROFILES,
  buildBeijingPersonalityAttractions,
} from "../src/personality/beijingAttractionProfiles.js";
import {
  deduplicateAttractions,
  generatePersonalizedRoute,
  normalizeAttractionName,
} from "../src/personality/personalizedRouteGenerator.js";
import { buildPlannerStateFromPersonalizedRoute } from "../src/personality/personalizedRouteAdapter.js";

const EXPECTED_CATALOG_NAMES = Object.freeze([
  "雍和宫",
  "五道营胡同",
  "国子监街",
  "东四艺文街区",
  "景山公园",
  "什刹海",
  "故宫博物院",
  "钟鼓楼胡同",
]);

const CURRENT_CATALOG_FIELDS = Object.freeze([
  ["75 分钟", 116.42370918, 39.953377859],
  ["90 分钟", 116.415124973, 39.954949461],
  ["60 分钟", 116.418891837, 39.951771858],
  ["90 分钟", 116.416619483, 39.92988923],
  ["80 分钟", 116.402818007, 39.93227005],
  ["90 分钟", 116.397197669, 39.94223553],
  ["100 分钟", 116.403414, 39.924091],
  ["70 分钟", 116.399153, 39.946598],
]);

const fixturePlaces = EXPECTED_CATALOG_NAMES.map((name, index) => ({
  id: index + 1,
  name,
  type: `类型 ${index + 1}`,
  image: `/assets/place-${index + 1}.webp`,
  duration: CURRENT_CATALOG_FIELDS[index][0],
  longitude: CURRENT_CATALOG_FIELDS[index][1],
  latitude: CURRENT_CATALOG_FIELDS[index][2],
  coordSystem: "BD09LL",
}));

function buildCompletePersonality() {
  let state = 7;
  const random = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  const questionIds = createDialectQuestionSequence(random);
  const answers = Object.fromEntries(questionIds.map((questionId) => {
    const question = getDialectPersonalityQuestion(questionId);
    return [questionId, question.options[0].id];
  }));
  return {
    questionIds,
    answers,
    result: computeDialectPersonality(answers, questionIds),
  };
}

function answersForCode(code, questionIds) {
  const desiredByAxis = Object.fromEntries(
    DIALECT_PERSONALITY_DIMENSIONS.map((dimension, index) => [dimension.id, code[index]]),
  );
  return Object.fromEntries(questionIds.map((questionId) => {
    const question = getDialectPersonalityQuestion(questionId);
    const option = question.options.find((candidate) => (
      candidate.code === desiredByAxis[candidate.axisId ?? question.axisId]
    ));
    assert.ok(option, `${questionId} should expose an option for ${code}`);
    return [questionId, option.id];
  }));
}

test("question sequence selects 15 unique questions with four-axis coverage", () => {
  const { questionIds } = buildCompletePersonality();
  assert.equal(questionIds.length, 15);
  assert.equal(new Set(questionIds).size, 15);
  for (const dimension of DIALECT_PERSONALITY_DIMENSIONS) {
    const dedicatedCount = questionIds.filter((questionId) => (
      getDialectPersonalityQuestion(questionId)?.axisId === dimension.id
    )).length;
    assert.ok(dedicatedCount >= 3, `${dimension.id} should have at least three dedicated questions`);
  }
});

test("15 answers produce one complete four-axis dialect personality", () => {
  const { result } = buildCompletePersonality();
  assert.equal(result.isComplete, true);
  assert.match(result.personalityCode, /^[AR][NF][GS][PW]$/u);
  assert.equal(result.dimensionResults.length, 4);
  for (const dimension of result.dimensionResults) {
    assert.equal(dimension.leftPercentage + dimension.rightPercentage, 100);
    assert.ok(dimension.answeredCount >= 3);
  }
});

test("all sixteen dialect personalities remain reachable", () => {
  for (let seed = 1; seed <= 4; seed += 1) {
    let state = seed;
    const random = () => {
      state = ((state * 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const questionIds = createDialectQuestionSequence(random);
    for (const persona of DIALECT_PERSONALITIES) {
      const result = computeDialectPersonality(answersForCode(persona.code, questionIds), questionIds);
      assert.equal(result.isComplete, true, `${seed}/${persona.code}`);
      assert.equal(result.personalityCode, persona.code, `${seed}/${persona.code}`);
      assert.equal(result.personalityId, persona.id);
    }
  }
});

test("incomplete answers never manufacture a personality or route", () => {
  const { questionIds, answers } = buildCompletePersonality();
  delete answers[questionIds.at(-1)];
  const result = computeDialectPersonality(answers, questionIds);
  const attractions = buildBeijingPersonalityAttractions(fixturePlaces);

  assert.equal(result.isComplete, false);
  assert.equal(result.personality, null);
  assert.equal(generatePersonalizedRoute(result, attractions), null);
});

test("the personality catalog covers the current eight Beijing places exactly", () => {
  assert.deepEqual(
    BEIJING_ATTRACTION_PROFILES.map((profile) => profile.name),
    EXPECTED_CATALOG_NAMES,
  );
  const attractions = buildBeijingPersonalityAttractions(fixturePlaces);
  assert.equal(attractions.length, 8);
  assert.deepEqual(attractions.map((attraction) => attraction.name), EXPECTED_CATALOG_NAMES);
  for (const attraction of attractions) {
    assert.ok(Number.isFinite(attraction.lon));
    assert.ok(Number.isFinite(attraction.lat));
    assert.equal(attraction.source.duration, fixturePlaces[attraction.id - 1].duration);
  }
});

test("profile join and final deduplication share one normalized-name rule", () => {
  const aliased = {
    ...fixturePlaces[0],
    id: "alias-first",
    name: "北京市雍和宫旅游区",
  };
  const attractions = buildBeijingPersonalityAttractions([aliased, fixturePlaces[0]]);
  assert.equal(attractions.length, 2);
  assert.equal(normalizeAttractionName(attractions[0].name), "雍和宫");
  const deduplicated = deduplicateAttractions(attractions);
  assert.equal(deduplicated.attractions.length, 1);
  assert.equal(deduplicated.attractions[0].id, "alias-first");
  assert.equal(deduplicated.duplicateExcluded, 1);
});

test("same normalized attraction name keeps exactly the first record", () => {
  const base = buildBeijingPersonalityAttractions(fixturePlaces)[0];
  const duplicate = {
    ...base,
    id: "duplicate-id",
    name: "北京雍和宫景区",
    lon: base.lon + 2,
    lat: base.lat + 2,
  };
  const distinct = {
    ...base,
    id: "distinct-id",
    name: "景山公园落日",
  };
  const result = deduplicateAttractions([base, duplicate, distinct]);

  assert.equal(normalizeAttractionName(base.name), normalizeAttractionName(duplicate.name));
  assert.equal(result.attractions.length, 2);
  assert.equal(result.duplicateExcluded, 1);
  assert.equal(result.attractions[0].id, base.id);
  assert.ok(result.attractions.some(({ id }) => id === "distinct-id"));
});

test("route generation is deterministic and respects day time windows", () => {
  const { result } = buildCompletePersonality();
  const attractions = buildBeijingPersonalityAttractions(fixturePlaces);
  const first = generatePersonalizedRoute(result, attractions, { variant: 0 });
  const second = generatePersonalizedRoute(result, attractions, { variant: 0 });

  assert.deepEqual(second, first);
  assert.ok(first.stops.length >= 2);
  assert.ok(first.stops.length <= attractions.length);
  assert.ok(first.matchScore >= 72 && first.matchScore <= 97);
  assert.equal(new Set(first.stops.map((stop) => normalizeAttractionName(stop.name))).size, first.stops.length);
  assert.ok(first.facts.candidateCount === attractions.length);

  for (const stop of first.stops) {
    const [hours, minutes] = stop.scheduledTime.split(":").map(Number);
    const start = hours * 60 + minutes;
    assert.ok(start <= 17 * 60);
    assert.ok(start + stop.durationMinutes <= 20 * 60);
    assert.ok(stop.day >= 1 && stop.day <= 3);
  }
});

test("visited names are excluded even when the candidate library drops below eight", () => {
  const { result } = buildCompletePersonality();
  const attractions = buildBeijingPersonalityAttractions(fixturePlaces);
  const route = generatePersonalizedRoute(result, attractions, {
    visitedNames: new Set(["北京雍和宫景区"]),
  });

  assert.ok(route);
  assert.equal(route.facts.candidateCount, 7);
  assert.equal(route.facts.visitedExcluded, 1);
  assert.ok(route.stops.every((stop) => normalizeAttractionName(stop.name) !== "雍和宫"));
});

test("one generated day adapts to the current 15-minute planner contract", () => {
  const { result } = buildCompletePersonality();
  const attractions = buildBeijingPersonalityAttractions(fixturePlaces);
  const route = generatePersonalizedRoute(result, attractions, { variant: 0 });
  const adapted = buildPlannerStateFromPersonalizedRoute(route, fixturePlaces, 1);

  assert.ok(new Set(route.stops.map((stop) => stop.day)).size > 1);
  assert.ok(adapted.timelineSlots.length >= 1);
  assert.equal(adapted.places.length, fixturePlaces.length);
  assert.equal(adapted.selectedRoute.activeDay, 1);
  assert.equal(adapted.selectedRoute.parentRouteId, route.id);
  assert.match(adapted.selectedRoute.title, /第 1 天/u);
  assert.ok(adapted.selectedRoute.stops.every((stop) => stop.day === 1));
  assert.deepEqual(adapted.selectedRoute.daysPlan, [{
    day: 1,
    stops: adapted.selectedRoute.stops.map((stop) => stop.id),
  }]);
  assert.deepEqual(adapted.plannerState, {
    constraints: [],
    transportModeOverrides: {},
  });
  for (const slot of adapted.timelineSlots) {
    assert.match(slot.time, /^\d{2}:\d{2}$/u);
    assert.equal(Number(slot.time.slice(3)) % 15, 0);
    assert.ok(adapted.places.some((place) => place.id === slot.stopId));
  }
  const selectedIds = new Set(adapted.timelineSlots.map((slot) => String(slot.stopId)));
  for (const original of fixturePlaces) {
    if (selectedIds.has(String(original.id))) continue;
    assert.deepEqual(
      adapted.places.find((place) => place.id === original.id),
      original,
      `unselected place ${original.name} must stay untouched`,
    );
  }
});
