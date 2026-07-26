import { findUnavailableWindowConflicts } from "./agent-constraints.js";

const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_SUGGESTED_TIME_LIMIT = 5;

function minutesOf(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
}

function timeOf(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function intervalsOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

export function findFeasibleTimesForStop(
  trip,
  target,
  derivedConstraints,
  { limit = DEFAULT_SUGGESTED_TIME_LIMIT } = {}
) {
  const durationMinutes = Number(target.durationMinutes);
  const otherStops = trip.stops.filter(
    (stop) => stop.clientStopId !== target.clientStopId
  );
  let hasFeasibleTime = false;
  const suggestedTimes = [];

  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > MINUTES_PER_DAY
  ) {
    return { hasFeasibleTime, suggestedTimes };
  }

  for (
    let startMinute = 0;
    startMinute + durationMinutes <= MINUTES_PER_DAY;
    startMinute += 15
  ) {
    const endMinute = startMinute + durationMinutes;
    const overlapsAnotherStop = otherStops.some((stop) => {
      const otherStart = minutesOf(stop.scheduledTime);
      const otherEnd = otherStart + Number(stop.durationMinutes);
      return intervalsOverlap(startMinute, endMinute, otherStart, otherEnd);
    });
    if (overlapsAnotherStop) continue;

    const scheduledTime = timeOf(startMinute);
    if (
      findUnavailableWindowConflicts(
        [{ ...target, scheduledTime }],
        derivedConstraints
      ).length > 0
    ) {
      continue;
    }

    hasFeasibleTime = true;
    if (
      scheduledTime !== target.scheduledTime &&
      suggestedTimes.length < limit
    ) {
      suggestedTimes.push(scheduledTime);
    }
  }

  return { hasFeasibleTime, suggestedTimes };
}

function groupConstraintConflicts(trip, derivedConstraints) {
  const stopsById = new Map(
    trip.stops.map((stop) => [stop.clientStopId, stop])
  );
  const grouped = new Map();
  for (const conflict of findUnavailableWindowConflicts(
    trip.stops,
    derivedConstraints
  )) {
    const current = grouped.get(conflict.clientStopId) ?? {
      stop: stopsById.get(conflict.clientStopId),
      unavailableWindows: new Map()
    };
    const window = conflict.unavailableWindow;
    current.unavailableWindows.set(
      window.id ?? window.constraintId,
      window
    );
    grouped.set(conflict.clientStopId, current);
  }
  return [...grouped.values()].sort((left, right) => (
    minutesOf(right.stop.scheduledTime) - minutesOf(left.stop.scheduledTime) ||
    left.stop.clientStopId.localeCompare(right.stop.clientStopId)
  ));
}

export function buildAgentPlanningHints(trip, derivedConstraints) {
  const constraintConflicts = groupConstraintConflicts(
    trip,
    derivedConstraints
  ).map(({ stop, unavailableWindows }) => {
    const feasibility = findFeasibleTimesForStop(
      trip,
      stop,
      derivedConstraints
    );
    return {
      clientStopId: stop.clientStopId,
      name: stop.name,
      scheduledTime: stop.scheduledTime,
      durationMinutes: stop.durationMinutes,
      locked: Boolean(stop.locked),
      unavailableWindows: [...unavailableWindows.values()].map(
        (window) => structuredClone(window)
      ),
      suggestedTimes: feasibility.suggestedTimes
    };
  });

  const nextActionCandidates = constraintConflicts.length === 0
    ? [{
        toolName: "finish_replan",
        arguments: {
          summary: "All derived hard scheduling constraints are satisfied."
        }
      }]
    : constraintConflicts.map((conflict) => {
        if (conflict.locked) {
          return {
            toolName: "set_stop_lock",
            arguments: {
              client_stop_id: conflict.clientStopId,
              locked: false,
              reason: "Unlock this conflicting stop before moving it."
            },
            thenSuggestedTimes: conflict.suggestedTimes
          };
        }
        if (conflict.suggestedTimes.length > 0) {
          return {
            toolName: "move_stop",
            arguments: {
              client_stop_id: conflict.clientStopId,
              new_scheduled_time: conflict.suggestedTimes[0],
              reason: "Move this conflict to the first server-validated feasible time."
            },
            alternativeTimes: conflict.suggestedTimes.slice(1)
          };
        }
        return {
          toolName: "remove_stop",
          arguments: {
            client_stop_id: conflict.clientStopId,
            reason: "No feasible non-overlapping same-day time remains."
          }
        };
      });

  return {
    version: 1,
    allDerivedConstraintsSatisfied: constraintConflicts.length === 0,
    remainingConflictCount: constraintConflicts.length,
    constraintConflicts,
    nextActionCandidates
  };
}
