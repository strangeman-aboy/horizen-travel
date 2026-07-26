import assert from "node:assert/strict";
import test from "node:test";
import { deriveAgentConstraints } from "../src/agent-constraints.js";
import {
  buildAgentPlanningHints,
  findFeasibleTimesForStop
} from "../src/agent-planning.js";

function sixStopTrip() {
  return {
    tripId: "trip-planning-hints-six-stops",
    stops: [
      {
        clientStopId: "stop-1",
        name: "上午活动",
        scheduledTime: "09:00",
        durationMinutes: 60,
        locked: false
      },
      {
        clientStopId: "stop-2",
        name: "午餐",
        scheduledTime: "12:00",
        durationMinutes: 90,
        locked: false
      },
      {
        clientStopId: "stop-3",
        name: "胡同散步",
        scheduledTime: "13:30",
        durationMinutes: 60,
        locked: false
      },
      {
        clientStopId: "stop-4",
        name: "景山公园预约",
        scheduledTime: "14:30",
        durationMinutes: 90,
        locked: true
      },
      {
        clientStopId: "stop-5",
        name: "咖啡休息",
        scheduledTime: "16:00",
        durationMinutes: 90,
        locked: false
      },
      {
        clientStopId: "stop-6",
        name: "傍晚活动",
        scheduledTime: "17:30",
        durationMinutes: 120,
        locked: false
      }
    ]
  };
}

test("planning hints find late same-day slots using duration, overlap, and unavailable windows", () => {
  const trip = sixStopTrip();
  const derivedConstraints = deriveAgentConstraints("我周六上午有事，请重新规划");
  const target = trip.stops[0];

  const feasible = findFeasibleTimesForStop(
    trip,
    target,
    derivedConstraints
  );
  assert.equal(feasible.hasFeasibleTime, true);
  assert.deepEqual(
    feasible.suggestedTimes,
    ["19:30", "19:45", "20:00", "20:15", "20:30"]
  );

  const hints = buildAgentPlanningHints(trip, derivedConstraints);
  assert.equal(hints.version, 1);
  assert.equal(hints.allDerivedConstraintsSatisfied, false);
  assert.equal(hints.remainingConflictCount, 1);
  assert.equal(hints.constraintConflicts[0].clientStopId, "stop-1");
  assert.deepEqual(
    hints.constraintConflicts[0].suggestedTimes,
    feasible.suggestedTimes
  );
  assert.deepEqual(hints.nextActionCandidates[0], {
    toolName: "move_stop",
    arguments: {
      client_stop_id: "stop-1",
      new_scheduled_time: "19:30",
      reason: "Move this conflict to the first server-validated feasible time."
    },
    alternativeTimes: ["19:45", "20:00", "20:15", "20:30"]
  });

  const movedTrip = {
    ...trip,
    stops: trip.stops.map((stop) => (
      stop.clientStopId === "stop-1"
        ? { ...stop, scheduledTime: "19:30" }
        : stop
    ))
  };
  const convergedHints = buildAgentPlanningHints(
    movedTrip,
    derivedConstraints
  );
  assert.equal(convergedHints.allDerivedConstraintsSatisfied, true);
  assert.equal(convergedHints.remainingConflictCount, 0);
  assert.equal(
    convergedHints.nextActionCandidates[0].toolName,
    "finish_replan"
  );
});
