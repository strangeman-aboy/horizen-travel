/**
 * Deterministic personality route generator adapted from Qianyouji.
 *
 * Pipeline:
 * four-axis fit -> normalized-name deduplication -> city cluster -> seeded
 * sampling -> nearest-neighbour chain -> time-window day packing.
 */

export const ROUTE_DIMENSION_WEIGHTS = Object.freeze({
  action: 0.27,
  novelty: 0.27,
  social: 0.2,
  structure: 0.26,
});

const LEVEL_QUALITY_SCORES = Object.freeze({
  AAAAA: 8,
  AAAA: 5.5,
  "省级": 3.5,
  AAA: 2,
  AA: 1,
  // The current eight-place prototype has no official scenic-area grading.
  // Keep its editorial "mature" label neutral, matching the source fallback.
  "成熟": 0.5,
});

const NAME_STRIP_PREFIXES = Object.freeze(["北京市", "北京"]);
const NAME_STRIP_SUFFIXES = Object.freeze([
  "旅游度假区",
  "旅游区",
  "旅游景区",
  "度假区",
  "风景名胜区",
  "文化产业园",
  "景区",
  "公园",
]);

const AXIS_COPY = Object.freeze({
  action: ["行动节奏", "先动起来", "想清再动"],
  novelty: ["新奇取向", "尝试新鲜", "偏爱熟悉"],
  social: ["同行氛围", "边聊边走", "独处观察"],
  structure: ["计划方式", "先定框架", "现场调整"],
});

const TONE_TITLES = Object.freeze({
  ANGP: "疾风密排", ANGW: "疾风野趣", ANSP: "快闪独行", ANSW: "随走随停",
  AFGP: "经典速通", AFGW: "稳妥快线", AFSP: "独行扫线", AFSW: "熟地漫游",
  RNGP: "慢品秘境", RNGW: "野趣慢旅", RNSP: "静谧深耕", RNSW: "随心慢逛",
  RFGP: "经典细品", RFGW: "从容漫游", RFSP: "独享经典", RFSW: "慢城漫游",
});

export const AVG_TRAVEL_SPEED_KMH = 45;
export const STOPOVER_BUFFER_MINUTES = 25;
export const FIRST_LEG_MINUTES = 30;
export const LATEST_ARRIVAL_MINUTES = 17 * 60;
export const DAY_END_MINUTES = 20 * 60;

const EARTH_RADIUS_KM = 6371;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const roundTo = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function haversineKm(lon1, lat1, lon2, lat2) {
  const toRad = (degree) => (degree * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function normalizeAttractionName(rawName) {
  let name = String(rawName ?? "").replace(/[\s（）()·]/gu, "");
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of NAME_STRIP_PREFIXES) {
      if (name.startsWith(prefix) && name.length > prefix.length + 1) {
        name = name.slice(prefix.length);
        changed = true;
      }
    }
    for (const suffix of NAME_STRIP_SUFFIXES) {
      if (name.endsWith(suffix) && name.length > suffix.length + 1) {
        name = name.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return name;
}

function hashString(text) {
  let hash = 5381;
  for (const character of String(text ?? "")) {
    hash = ((hash << 5) + hash + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isVisitedName(normalizedName, visitedNames) {
  if (visitedNames.has(normalizedName)) return true;
  for (const visitedName of visitedNames) {
    if (
      (visitedName.length >= 2 && normalizedName.includes(visitedName))
      || (normalizedName.length >= 2 && visitedName.includes(normalizedName))
    ) return true;
  }
  return false;
}

/**
 * The product rule is intentionally name-first: once two names normalize to
 * the same value, they are the same attraction and only the first survives.
 * City and coordinates do not override that decision.
 */
export function deduplicateAttractions(attractions = [], visitedNames = []) {
  const visited = new Set(
    [...(visitedNames instanceof Set ? visitedNames : visitedNames ?? [])]
      .map(normalizeAttractionName)
      .filter(Boolean),
  );
  const seen = new Set();
  const unique = [];
  let duplicateExcluded = 0;
  let visitedExcluded = 0;

  for (const attraction of Array.isArray(attractions) ? attractions : []) {
    const lon = Number(attraction?.lon);
    const lat = Number(attraction?.lat);
    const normalizedName = normalizeAttractionName(attraction?.name);
    if (!normalizedName || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (isVisitedName(normalizedName, visited)) {
      visitedExcluded += 1;
      continue;
    }
    if (seen.has(normalizedName)) {
      duplicateExcluded += 1;
      continue;
    }
    seen.add(normalizedName);
    unique.push({ ...attraction, lon, lat, normalizedName });
  }

  return { attractions: unique, duplicateExcluded, visitedExcluded };
}

function attractionAxisPercentages(attraction) {
  const scores = attraction?.scores ?? {};
  const pairPercentage = (leftCode, rightCode) => {
    const left = Number(scores[leftCode]) || 0;
    const right = Number(scores[rightCode]) || 0;
    return left + right > 0 ? (left / (left + right)) * 100 : 50;
  };
  return {
    action: pairPercentage("A", "R"),
    novelty: pairPercentage("N", "F"),
    social: pairPercentage("G", "S"),
    structure: pairPercentage("P", "W"),
  };
}

export function scoreAttraction(attraction, userPercentages, weights = ROUTE_DIMENSION_WEIGHTS) {
  const attractionPercentages = attractionAxisPercentages(attraction);
  const dimensionScores = {};
  let fit = 0;
  for (const [axis, weight] of Object.entries(weights)) {
    const dimensionScore = 100 - Math.abs(
      (userPercentages?.[axis] ?? 50) - attractionPercentages[axis],
    );
    dimensionScores[axis] = roundTo(dimensionScore, 1);
    fit += dimensionScore * weight;
  }
  const levelScore = LEVEL_QUALITY_SCORES[attraction?.level] ?? 0.5;
  const noveltyPenalty = 1 - ((userPercentages?.novelty ?? 50) / 100) * 0.6;
  const quality = levelScore * noveltyPenalty;
  return {
    fit: roundTo(fit, 1),
    quality: roundTo(quality, 1),
    total: roundTo(fit + quality * 0.6, 1),
    dimensionScores,
    attractionPercentages,
  };
}

export function derivePaceFromPersonality(userPercentages = {}) {
  const action = userPercentages.action ?? 50;
  const novelty = userPercentages.novelty ?? 50;
  const social = userPercentages.social ?? 50;
  const structure = userPercentages.structure ?? 50;
  let days = 2;
  let stopsPerDay = 3;
  let departTime = "09:00";

  if (action >= 65) {
    days = 1;
    stopsPerDay = 5;
    departTime = "08:00";
  } else if (action <= 35) {
    days = 3;
    stopsPerDay = 2;
    departTime = "10:00";
  }
  if (novelty >= 65) stopsPerDay = Math.max(2, stopsPerDay - 1);

  return {
    days,
    stopsPerDay,
    departTime,
    preciseSchedule: structure >= 40,
    preferEveningSocialStop: social >= 55,
    preferMorningQuietStop: social <= 45,
  };
}

function pickCityCluster(scoredAttractions, neededCount, random) {
  const byCity = new Map();
  for (const item of scoredAttractions) {
    const city = item.attraction.city ?? "未知地区";
    if (!byCity.has(city)) byCity.set(city, []);
    byCity.get(city).push(item);
  }
  const clusters = [...byCity.entries()].map(([city, items]) => {
    const sorted = [...items].sort((left, right) => right.total - left.total);
    const head = sorted.slice(0, Math.max(1, Math.min(sorted.length, Math.max(8, neededCount))));
    const averageFit = head.reduce((sum, item) => sum + item.total, 0) / head.length;
    const surplusBonus = clamp((items.length / Math.max(1, neededCount)) * 1.6, 0, 6);
    return { city, items: sorted, averageFit, score: averageFit + surplusBonus };
  }).sort((left, right) => right.score - left.score || left.city.localeCompare(right.city, "zh-CN"));
  if (!clusters.length) return null;
  const viable = clusters.filter(({ items }) => items.length >= neededCount);
  const candidates = viable.length ? viable : clusters;
  const top = candidates.filter((cluster) => cluster.score >= candidates[0].score - 4);
  return top[Math.floor(random() * top.length)];
}

function nearestNeighborChain(items, seedItem) {
  const remaining = [...items];
  const chain = [seedItem];
  remaining.splice(remaining.indexOf(seedItem), 1);
  let current = seedItem;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    remaining.forEach((item, index) => {
      const distance = haversineKm(
        current.attraction.lon,
        current.attraction.lat,
        item.attraction.lon,
        item.attraction.lat,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    current = remaining.splice(bestIndex, 1)[0];
    chain.push(current);
  }
  return chain;
}

function stopDurationMinutes(attraction) {
  // Source rule retained for this baseline: R controls dwell time. The
  // original catalog duration remains available on attraction.source.
  const reflectiveScore = Number(attraction?.scores?.R) || 5;
  return Math.round(60 + reflectiveScore * 12);
}

function travelMinutesBetween(left, right) {
  const distance = haversineKm(left.lon, left.lat, right.lon, right.lat);
  return Math.max(20, Math.round((distance / AVG_TRAVEL_SPEED_KMH) * 60));
}

const parseTime = (time) => {
  const [hours, minutes] = String(time).split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

const formatTime = (minutes) => (
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
);

const fuzzyPeriodForMinute = (minutes) => {
  if (minutes < 12 * 60) return "上午";
  if (minutes < 14 * 60) return "午后";
  if (minutes < 17 * 60) return "下午";
  if (minutes < 19 * 60) return "傍晚";
  return "晚上";
};

function packChainIntoDays(chain, pace, startMinutes) {
  const groups = [];
  let current = [];
  let cursor = startMinutes + FIRST_LEG_MINUTES;
  let previous = null;

  for (const item of chain) {
    const duration = stopDurationMinutes(item.attraction);
    const travelMinutes = previous
      ? travelMinutesBetween(previous.attraction, item.attraction) + STOPOVER_BUFFER_MINUTES
      : 0;
    const arrival = cursor + travelMinutes;
    const fits = !previous || (
      arrival <= LATEST_ARRIVAL_MINUTES
      && arrival + duration <= DAY_END_MINUTES
      && current.length < pace.stopsPerDay
    );
    if (fits) {
      current.push(item);
      cursor = arrival + duration;
      previous = item;
    } else {
      groups.push(current);
      current = [item];
      cursor = startMinutes + FIRST_LEG_MINUTES + duration;
      previous = item;
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function groupFitsDayWindow(group, startMinutes) {
  let cursor = startMinutes + FIRST_LEG_MINUTES;
  let previous = null;
  for (const item of group) {
    if (previous) {
      cursor += travelMinutesBetween(previous.attraction, item.attraction)
        + STOPOVER_BUFFER_MINUTES;
    }
    if (cursor > LATEST_ARRIVAL_MINUTES) return false;
    cursor += stopDurationMinutes(item.attraction);
    if (cursor > DAY_END_MINUTES) return false;
    previous = item;
  }
  return true;
}

function movePreferredStop(group, predicate, targetIndex, startMinutes) {
  if (group.length < 2) return;
  const preferred = group.reduce((best, item) => (predicate(item) > predicate(best) ? item : best));
  if (group[targetIndex] === preferred) return;
  const backup = [...group];
  group.splice(group.indexOf(preferred), 1);
  if (targetIndex === 0) group.unshift(preferred);
  else group.push(preferred);
  if (!groupFitsDayWindow(group, startMinutes)) group.splice(0, group.length, ...backup);
}

function buildDaySchedule(dayItems, pace, startMinutes, dayIndex) {
  let cursor = startMinutes + FIRST_LEG_MINUTES;
  let previous = null;
  return dayItems.map((item, stopIndex) => {
    let travelFromPreviousKm = 0;
    if (previous) {
      travelFromPreviousKm = haversineKm(
        previous.attraction.lon,
        previous.attraction.lat,
        item.attraction.lon,
        item.attraction.lat,
      );
      cursor += travelMinutesBetween(previous.attraction, item.attraction)
        + STOPOVER_BUFFER_MINUTES;
    }
    const durationMinutes = stopDurationMinutes(item.attraction);
    const scheduledTime = formatTime(cursor);
    const entry = {
      ...item,
      day: dayIndex + 1,
      order: stopIndex + 1,
      scheduledTime,
      displayTime: pace.preciseSchedule ? scheduledTime : fuzzyPeriodForMinute(cursor),
      durationMinutes,
      travelFromPreviousKm: roundTo(travelFromPreviousKm, 1),
    };
    cursor += durationMinutes;
    previous = item;
    return entry;
  });
}

function extractUserPercentages(personalityResult) {
  const percentages = {};
  for (const dimension of personalityResult?.dimensionResults ?? []) {
    if (
      Object.hasOwn(ROUTE_DIMENSION_WEIGHTS, dimension?.id)
      && dimension?.leftPercentage != null
    ) {
      percentages[dimension.id] = clamp(Number(dimension.leftPercentage), 0, 100);
    }
  }
  return percentages;
}

function buildStopReason(item, userPercentages) {
  const axis = Object.keys(item.dimensionScores).reduce((best, candidate) => (
    item.dimensionScores[candidate] > item.dimensionScores[best] ? candidate : best
  ), "action");
  const [, leftLabel, rightLabel] = AXIS_COPY[axis];
  const leaningLabel = (userPercentages[axis] ?? 50) >= 50 ? leftLabel : rightLabel;
  return `“${item.attraction.source?.type ?? item.attraction.name}”与这次的${leaningLabel}倾向最接近。`;
}

export function generatePersonalizedRoute(personalityResult, attractions, options = {}) {
  const userPercentages = extractUserPercentages(personalityResult);
  const personalityCode = String(personalityResult?.personalityCode ?? "");
  if (Object.keys(userPercentages).length < 4 || !/^[AR][NF][GS][PW]$/u.test(personalityCode)) {
    return null;
  }

  const deduplicated = deduplicateAttractions(attractions, options.visitedNames ?? []);
  if (deduplicated.attractions.length < 2) return null;
  const scored = deduplicated.attractions.map((attraction) => ({
    attraction,
    ...scoreAttraction(attraction, userPercentages),
  }));
  const pace = derivePaceFromPersonality(userPercentages);
  const desiredStops = Math.min(pace.days * pace.stopsPerDay, scored.length);
  const random = createSeededRandom(hashString(`${personalityCode}#${options.variant ?? 0}`));
  const cluster = pickCityCluster(scored, desiredStops, random);
  if (!cluster || cluster.items.length < 2) return null;

  const totalStops = Math.min(desiredStops, cluster.items.length);
  // Retain Qianyouji's deterministic draw from the top (needed + 4) pool.
  // With today's eight-place catalog this intentionally behaves as a seeded
  // permutation; scoring still selects the route seed and explains fit.
  const pool = cluster.items.slice(0, Math.min(cluster.items.length, totalStops + 4));
  const picked = [];
  while (picked.length < totalStops && pool.length) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  const seed = picked.reduce((best, item) => (!best || item.total > best.total ? item : best), null);
  const chain = nearestNeighborChain(picked, seed);

  let scheduleStart = parseTime(pace.departTime);
  if (pace.preferMorningQuietStop) scheduleStart -= 30;
  if (pace.preferEveningSocialStop) scheduleStart += 30;
  scheduleStart = clamp(scheduleStart, 7 * 60, 11 * 60);

  const maximumDays = Math.min(3, pace.days + 1);
  const dayGroups = packChainIntoDays(chain, pace, scheduleStart)
    .slice(0, maximumDays)
    .filter((group) => group.length);
  if (!dayGroups.length) return null;

  for (const group of dayGroups) {
    if (pace.preferMorningQuietStop) {
      movePreferredStop(group, (item) => item.attraction.scores?.S ?? 5, 0, scheduleStart);
    }
    if (pace.preferEveningSocialStop) {
      movePreferredStop(group, (item) => item.attraction.scores?.G ?? 5, -1, scheduleStart);
    }
  }

  const scheduledDays = dayGroups.map((group, dayIndex) => (
    buildDaySchedule(group, pace, scheduleStart, dayIndex)
  ));
  const scheduled = scheduledDays.flat();
  if (scheduled.length < 2) return null;
  const averageFit = scheduled.reduce((sum, item) => sum + item.fit, 0) / scheduled.length;
  const segmentDistances = scheduled
    .map((item) => item.travelFromPreviousKm)
    .filter((distance) => distance > 0);
  const averageSegmentKm = segmentDistances.length
    ? roundTo(segmentDistances.reduce((sum, distance) => sum + distance, 0) / segmentDistances.length, 1)
    : 0;
  const matchScore = Math.round(clamp(68 + (averageFit - 72) * 1.5, 72, 97));
  const toneTitle = TONE_TITLES[personalityCode] ?? "专属定制";
  const personaName = personalityResult?.personality?.dialectName ?? personalityCode;
  const profileKey = personalityResult?.profileKey ?? personalityCode;
  const routeId = `personalized-${hashString(`${profileKey}|${cluster.city}|${options.variant ?? 0}`)}`;

  const stops = scheduled.map((item) => ({
    id: item.attraction.id,
    name: item.attraction.name,
    city: item.attraction.city,
    day: item.day,
    order: item.order,
    scheduledTime: item.scheduledTime,
    displayTime: item.displayTime,
    durationMinutes: item.durationMinutes,
    travelFromPreviousKm: item.travelFromPreviousKm,
    fit: item.fit,
    reason: buildStopReason(item, userPercentages),
    source: item.attraction.source,
  }));

  return {
    id: routeId,
    title: `${cluster.city} · ${scheduledDays.length}日 · ${toneTitle}线`,
    city: cluster.city,
    days: `${scheduledDays.length} 天 · ${stops.length} 站`,
    tag: "人格专属",
    creator: "串 Knot 人格引擎",
    followers: `候选库 ${deduplicated.attractions.length} 个景点`,
    budget: "按实际消费",
    image: stops[0]?.source?.image ?? "/assets/beijing-hero-hutong.webp",
    avatar: "/assets/creator-chen.webp",
    summary: `${personaName}的四维结果生成了这条路线：先按名称去重，再完成匹配、选点、串联和分日。`,
    highlights: stops.slice(0, 4).map((stop) => stop.name),
    generated: true,
    personalityCode,
    matchScore,
    matchExplanation: `从 ${Array.isArray(attractions) ? attractions.length : 0} 个输入景点中保留 ${deduplicated.attractions.length} 个唯一候选，四维平均兼容分 ${roundTo(averageFit, 1)}。`,
    pace: {
      days: scheduledDays.length,
      stopsPerDay: pace.stopsPerDay,
      departTime: pace.departTime,
      preciseSchedule: pace.preciseSchedule,
    },
    facts: {
      sourceCount: Array.isArray(attractions) ? attractions.length : 0,
      candidateCount: deduplicated.attractions.length,
      duplicateExcluded: deduplicated.duplicateExcluded,
      visitedExcluded: deduplicated.visitedExcluded,
      averageFit: roundTo(averageFit, 1),
      averageSegmentKm,
    },
    stops,
    daysPlan: scheduledDays.map((items, dayIndex) => ({
      day: dayIndex + 1,
      stops: items.map((item) => item.attraction.id),
    })),
  };
}
