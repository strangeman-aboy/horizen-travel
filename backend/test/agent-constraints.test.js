import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveAgentConstraints,
  findUnavailableWindowConflicts,
  mergeDerivedConstraintsIntoPlannerState,
  plannerConstraintsFromDerived
} from "../src/agent-constraints.js";

test("derives the stable Saturday-morning hard constraint only from blocking language", () => {
  const derived = deriveAgentConstraints(
    "我周六上午有事，请帮我重新规划。保留14:30已经预约的景山公园。"
  );

  assert.equal(derived.version, 1);
  assert.equal(derived.unavailableWindows.length, 1);
  assert.deepEqual(
    derived.unavailableWindows[0],
    {
      id: "saturday-morning",
      constraintId: "saturday-morning",
      type: "unavailable_time_window",
      startTime: "00:00",
      endTime: "12:00",
      startMinute: 0,
      endMinute: 720,
      sourceExpression: "上午",
      blockingPhrase: "有事",
      sourceText: "我周六上午有事"
    }
  );

  const plannerConstraint = plannerConstraintsFromDerived(derived)[0];
  assert.deepEqual(plannerConstraint, {
    id: "saturday-morning",
    type: "unavailable",
    startTime: "09:00",
    endTime: "12:00",
    evidence: "我周六上午有事",
    source: "agent_instruction",
    hard: true
  });
});

test("supports Chinese periods and explicit ranges with conservative blocking phrases", () => {
  const cases = [
    ["早上没空", "00:00", "12:00", "没空"],
    ["上午有事", "00:00", "12:00", "有事"],
    ["下午不能安排", "12:00", "18:00", "不能安排"],
    ["下午不方便", "12:00", "18:00", "不方便"],
    ["晚上不可安排", "18:00", "24:00", "不可安排"],
    ["晚上无法安排", "18:00", "24:00", "无法安排"],
    ["早上没有空", "00:00", "12:00", "没有空"],
    ["我10:30到12点没空", "10:30", "12:00", "没空"],
    ["10点半至12:15不能安排", "10:30", "12:15", "不能安排"]
  ];

  for (const [instruction, startTime, endTime, blockingPhrase] of cases) {
    const windows = deriveAgentConstraints(instruction).unavailableWindows;
    assert.equal(windows.length, 1, instruction);
    assert.equal(windows[0].startTime, startTime, instruction);
    assert.equal(windows[0].endTime, endTime, instruction);
    assert.equal(windows[0].blockingPhrase, blockingPhrase, instruction);
  }
});

test("does not infer unavailability from a desired period or a negated blocker", () => {
  assert.deepEqual(
    deriveAgentConstraints("我想上午去故宫").unavailableWindows,
    []
  );
  assert.deepEqual(
    deriveAgentConstraints("我上午没有事情，可以正常安排").unavailableWindows,
    []
  );
  assert.deepEqual(
    deriveAgentConstraints("上午去故宫，下午去景山").unavailableWindows,
    []
  );
});

test("merges derived constraints without losing prior state or duplicating ids", () => {
  const plannerState = {
    constraints: [
      { type: "pace", value: "relaxed" },
      {
        id: "saturday-morning",
        type: "unavailable",
        startTime: "09:00",
        endTime: "12:00",
        evidence: "用户此前已设置",
        source: "user",
        hard: true
      }
    ],
    transportModeOverrides: {
      "stop-a:stop-b": "walking"
    }
  };
  const derived = deriveAgentConstraints("我周六上午有事，请重新规划");
  const merged = mergeDerivedConstraintsIntoPlannerState(plannerState, derived);

  assert.deepEqual(merged, plannerState);
  assert.notEqual(merged, plannerState);
  assert.notEqual(merged.constraints, plannerState.constraints);
  assert.notEqual(
    merged.transportModeOverrides,
    plannerState.transportModeOverrides
  );
});

test("reports every stop interval overlapping a derived unavailable window", () => {
  const derived = deriveAgentConstraints("上午有事");
  const conflicts = findUnavailableWindowConflicts([
    {
      clientStopId: "stop-a",
      name: "早餐",
      scheduledTime: "09:00",
      durationMinutes: 60,
      locked: false
    },
    {
      clientStopId: "stop-b",
      name: "跨边界活动",
      scheduledTime: "11:30",
      durationMinutes: 60,
      locked: true
    },
    {
      clientStopId: "stop-c",
      name: "午后活动",
      scheduledTime: "12:30",
      durationMinutes: 60,
      locked: false
    }
  ], derived);

  assert.deepEqual(
    conflicts.map((conflict) => conflict.clientStopId),
    ["stop-a", "stop-b"]
  );
  assert.equal(conflicts[1].locked, true);
  assert.equal(conflicts[1].unavailableWindow.endTime, "12:00");
});
