import assert from "node:assert/strict";
import test from "node:test";

import {
  PLANNER_AGENT_DEMO_STEPS,
  applyPlannerAgentDemoStep,
  buildPlannerAgentDemoOperations,
  createPlannerAgentDemoState,
} from "../src/agent/plannerAgentDemo.js";

const initialTimelineSlots = [
  { slotId: "slot-1", stopId: 1, time: "09:00" },
  { slotId: "slot-2", stopId: 2, time: "10:30" },
  { slotId: "slot-3", stopId: 3, time: "12:15" },
  { slotId: "slot-4", stopId: 4, time: "13:45" },
  { slotId: "slot-5", stopId: 5, time: "15:45" },
  { slotId: "slot-6", stopId: 6, time: "17:30" },
];

test("the planner Agent demo restores the four visible operations", () => {
  const state = createPlannerAgentDemoState();
  const operations = buildPlannerAgentDemoOperations({
    ...state,
    phase: "running",
    previewOperation: PLANNER_AGENT_DEMO_STEPS[0],
  });

  assert.deepEqual(
    operations.map(({ title, status }) => ({ title, status })),
    [
      { title: "写入新的时间约束", status: "STARTED" },
      { title: "保留其余四站", status: "PENDING" },
      { title: "顺延两个上午地点", status: "PENDING" },
      { title: "校验交通与间隔", status: "PENDING" },
    ],
  );
});

test("the complete demo leaves Saturday morning empty while only moving the two affected stops", () => {
  let timelineSlots = initialTimelineSlots;
  let constraints = [];

  for (const step of PLANNER_AGENT_DEMO_STEPS) {
    const result = applyPlannerAgentDemoStep({
      timelineSlots,
      constraints,
      step,
    });
    timelineSlots = result.timelineSlots;
    constraints = result.constraints;
  }

  assert.deepEqual(
    timelineSlots.map(({ stopId, time }) => ({ stopId, time })),
    [
      { stopId: 3, time: "12:15" },
      { stopId: 4, time: "13:45" },
      { stopId: 5, time: "15:45" },
      { stopId: 6, time: "17:30" },
      { stopId: 1, time: "19:30" },
      { stopId: 2, time: "21:00" },
    ],
  );
  assert.equal(constraints.some(({ id }) => id === "saturday-morning"), true);
  assert.equal(timelineSlots.some(({ time }) => time >= "09:00" && time < "12:00"), false);
  assert.deepEqual(
    timelineSlots
      .filter(({ stopId }) => [3, 4, 5, 6].includes(stopId))
      .map(({ stopId, time }) => ({ stopId, time })),
    initialTimelineSlots
      .filter(({ stopId }) => [3, 4, 5, 6].includes(stopId))
      .map(({ stopId, time }) => ({ stopId, time })),
  );
});

test("the local move preserves a stop taken over manually", () => {
  const manuallyEdited = initialTimelineSlots.map((slot) => (
    slot.stopId === 1 ? { ...slot, time: "09:15" } : slot
  ));
  const result = applyPlannerAgentDemoStep({
    timelineSlots: manuallyEdited,
    constraints: [],
    step: PLANNER_AGENT_DEMO_STEPS.find(({ kind }) => kind === "move"),
    manuallyChangedStopIds: [1],
  });

  assert.equal(result.timelineSlots.find(({ stopId }) => stopId === 1)?.time, "09:15");
  assert.equal(result.timelineSlots.find(({ stopId }) => stopId === 2)?.time, "21:00");
  assert.equal(result.changedStopIds.includes(1), false);
  assert.equal(result.changedStopIds.includes(2), true);
});
