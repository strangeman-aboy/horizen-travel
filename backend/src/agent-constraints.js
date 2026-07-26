const PERIOD_WINDOWS = Object.freeze({
  "早上": Object.freeze({ startMinute: 0, endMinute: 12 * 60 }),
  "上午": Object.freeze({ startMinute: 0, endMinute: 12 * 60 }),
  "下午": Object.freeze({ startMinute: 12 * 60, endMinute: 18 * 60 }),
  "晚上": Object.freeze({ startMinute: 18 * 60, endMinute: 24 * 60 })
});

const BLOCKING_PHRASES = Object.freeze([
  "不能安排",
  "不可安排",
  "无法安排",
  "不方便",
  "没有空",
  "没空",
  "有事"
]);

const TIME_TOKEN_SOURCE =
  "(?:24:00|(?:[01]?\\d|2[0-3])(?::[0-5]\\d|点(?:(?:[0-5]?\\d)分?|半)?))";
const TIME_RANGE_PATTERN = new RegExp(
  `(${TIME_TOKEN_SOURCE})\\s*(?:到|至|—|–|-|~|～)\\s*(${TIME_TOKEN_SOURCE})`,
  "g"
);
const PERIOD_PATTERN = /早上|上午|下午|晚上/g;
const CLAUSE_SEPARATOR_PATTERN = /[，,。；;！？!?]/;

function minuteLabel(minute) {
  if (minute === 24 * 60) return "24:00";
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseTimeToken(value) {
  const token = String(value).trim();
  if (token === "24:00") return 24 * 60;
  const colon = token.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const chinese = token.match(/^(\d{1,2})点(?:(\d{1,2})分|(半))?$/);
  if (!chinese) return null;
  return Number(chinese[1]) * 60 + (
    chinese[3] === "半" ? 30 : Number(chinese[2] ?? 0)
  );
}

function spanDistance(left, right) {
  if (left.end < right.start) return right.start - left.end;
  if (right.end < left.start) return left.start - right.end;
  return 0;
}

function findBlockingPhrases(clause) {
  const matches = [];
  for (const phrase of BLOCKING_PHRASES) {
    let cursor = 0;
    while (cursor < clause.length) {
      const index = clause.indexOf(phrase, cursor);
      if (index < 0) break;
      cursor = index + phrase.length;
      if (
        phrase === "有事" &&
        (clause[index - 1] === "没" || clause.slice(Math.max(0, index - 2), index) === "没有")
      ) {
        continue;
      }
      matches.push({ phrase, start: index, end: index + phrase.length });
    }
  }
  return matches.sort((left, right) => left.start - right.start);
}

function findTimeRanges(clause) {
  const ranges = [];
  TIME_RANGE_PATTERN.lastIndex = 0;
  for (const match of clause.matchAll(TIME_RANGE_PATTERN)) {
    const startMinute = parseTimeToken(match[1]);
    const endMinute = parseTimeToken(match[2]);
    if (
      startMinute === null ||
      endMinute === null ||
      startMinute >= endMinute
    ) {
      continue;
    }
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      startMinute,
      endMinute,
      sourceExpression: match[0]
    });
  }
  return ranges;
}

function findPeriods(clause) {
  const periods = [];
  PERIOD_PATTERN.lastIndex = 0;
  for (const match of clause.matchAll(PERIOD_PATTERN)) {
    periods.push({
      start: match.index,
      end: match.index + match[0].length,
      period: match[0],
      ...PERIOD_WINDOWS[match[0]]
    });
  }
  return periods;
}

function createUnavailableWindow({
  startMinute,
  endMinute,
  sourceExpression,
  blockingPhrase,
  clause
}) {
  const saturdayMorning = (
    /(?:周六|星期六|礼拜六)/.test(clause) &&
    /^(?:早上|上午)$/.test(sourceExpression) &&
    endMinute === 12 * 60
  );
  const constraintId = saturdayMorning
    ? "saturday-morning"
    : `agent-unavailable-${minuteLabel(startMinute).replace(":", "")}-${minuteLabel(endMinute).replace(":", "")}`;
  return {
    id: constraintId,
    constraintId,
    type: "unavailable_time_window",
    startTime: minuteLabel(startMinute),
    endTime: minuteLabel(endMinute),
    startMinute,
    endMinute,
    sourceExpression,
    blockingPhrase,
    sourceText: clause.trim()
  };
}

export function plannerConstraintsFromDerived(derivedConstraints) {
  return (derivedConstraints?.unavailableWindows ?? []).map((window) => ({
    id: window.id ?? window.constraintId,
    type: "unavailable",
    startTime: window.id === "saturday-morning" ? "09:00" : window.startTime,
    endTime: window.endTime,
    evidence: window.sourceText,
    source: "agent_instruction",
    hard: true
  }));
}

export function mergeDerivedConstraintsIntoPlannerState(
  plannerState,
  derivedConstraints
) {
  const current = plannerState ?? {
    constraints: [],
    transportModeOverrides: {}
  };
  const constraints = Array.isArray(current.constraints)
    ? current.constraints.map((constraint) => structuredClone(constraint))
    : [];
  const knownIds = new Set(
    constraints.map((constraint) => constraint?.id).filter(Boolean)
  );
  for (const constraint of plannerConstraintsFromDerived(derivedConstraints)) {
    if (knownIds.has(constraint.id)) continue;
    constraints.push(constraint);
    knownIds.add(constraint.id);
  }
  return {
    constraints,
    transportModeOverrides: {
      ...(current.transportModeOverrides ?? {})
    }
  };
}

export function deriveAgentConstraints(instruction) {
  const unavailableWindows = new Map();
  const clauses = String(instruction ?? "")
    .split(CLAUSE_SEPARATOR_PATTERN)
    .map((clause) => clause.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const blockers = findBlockingPhrases(clause);
    if (blockers.length === 0) continue;
    const timeRanges = findTimeRanges(clause);
    const periods = findPeriods(clause);

    for (const blocker of blockers) {
      const nearestRange = timeRanges
        .map((range) => ({
          range,
          distance: spanDistance(blocker, range)
        }))
        .filter(({ distance }) => distance <= 20)
        .sort((left, right) => left.distance - right.distance)[0]?.range;
      if (nearestRange) {
        const window = createUnavailableWindow({
          ...nearestRange,
          blockingPhrase: blocker.phrase,
          clause
        });
        unavailableWindows.set(window.constraintId, window);
        continue;
      }

      const nearestPeriod = periods
        .map((period) => ({
          period,
          distance: spanDistance(blocker, period)
        }))
        .filter(({ distance }) => distance <= 12)
        .sort((left, right) => left.distance - right.distance)[0]?.period;
      if (!nearestPeriod) continue;
      const window = createUnavailableWindow({
        ...nearestPeriod,
        sourceExpression: nearestPeriod.period,
        blockingPhrase: blocker.phrase,
        clause
      });
      unavailableWindows.set(window.constraintId, window);
    }
  }

  return {
    version: 1,
    unavailableWindows: [...unavailableWindows.values()]
  };
}

function stopInterval(stop) {
  const [hours, minutes] = String(stop.scheduledTime).split(":").map(Number);
  const startMinute = hours * 60 + minutes;
  return {
    startMinute,
    endMinute: startMinute + Number(stop.durationMinutes)
  };
}

export function findUnavailableWindowConflicts(stops, derivedConstraints) {
  const windows = derivedConstraints?.unavailableWindows ?? [];
  const conflicts = [];
  for (const stop of stops ?? []) {
    const interval = stopInterval(stop);
    for (const window of windows) {
      if (
        interval.startMinute < window.endMinute &&
        interval.endMinute > window.startMinute
      ) {
        conflicts.push({
          clientStopId: stop.clientStopId,
          name: stop.name,
          scheduledTime: stop.scheduledTime,
          durationMinutes: stop.durationMinutes,
          locked: Boolean(stop.locked),
          stopStartMinute: interval.startMinute,
          stopEndMinute: interval.endMinute,
          unavailableWindow: structuredClone(window)
        });
      }
    }
  }
  return conflicts;
}
