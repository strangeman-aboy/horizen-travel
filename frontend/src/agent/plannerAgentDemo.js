export const PLANNER_AGENT_DEMO_PROMPT = "我周六上午有事，请帮我重新规划";

export const PLANNER_AGENT_DEMO_STEPS = Object.freeze([
  Object.freeze({
    operationId: "demo-constraint",
    type: "constraint.add",
    title: "写入新的时间约束",
    detail: "周六 09:00—12:00 标记为不可安排",
    kind: "constraint",
  }),
  Object.freeze({
    operationId: "demo-protect",
    type: "stop.protect",
    title: "保留其余四站",
    detail: "中午后的地点、交通方式和顺序都保持原位",
    kind: "protect",
    protectedStopIds: Object.freeze([3, 4, 5, 6]),
  }),
  Object.freeze({
    operationId: "demo-move",
    type: "stop.move",
    title: "顺延两个上午地点",
    detail: "只把雍和宫、五道营胡同移到晚间空档",
    kind: "move",
    stopIds: Object.freeze([1, 2]),
  }),
  Object.freeze({
    operationId: "demo-validate",
    type: "schedule.validate",
    title: "校验交通与间隔",
    detail: "确认没有新增冲突，全部时间仍按 15 分钟对齐",
    kind: "validate",
  }),
]);

export const PLANNER_AGENT_DEMO_TIMES = Object.freeze({
  1: "19:30",
  2: "21:00",
});

export function createPlannerAgentDemoState() {
  return {
    phase: "idle",
    stepIndex: 0,
    previewOperation: null,
    changedStopIds: [],
    messages: [],
    snapshot: null,
    isPersisting: false,
    error: null,
  };
}

function timeToMinutes(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutes(minutes) {
  const bounded = Math.max(0, Math.min(24 * 60 - 15, minutes));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

function sortSlots(slots) {
  return [...slots].sort((left, right) => (
    timeToMinutes(left.time) - timeToMinutes(right.time)
    || String(left.slotId).localeCompare(String(right.slotId))
  ));
}

function scheduleStops(timelineSlots, stopIds, manuallyChangedStopIds) {
  const targets = new Set(stopIds.map(Number));
  const manuallyChanged = new Set([...manuallyChangedStopIds].map(Number));
  const occupiedMinutes = new Set(
    timelineSlots
      .filter((slot) => !targets.has(Number(slot.stopId)) || manuallyChanged.has(Number(slot.stopId)))
      .map((slot) => timeToMinutes(slot.time)),
  );

  return sortSlots(timelineSlots.map((slot) => {
    const stopId = Number(slot.stopId);
    if (!targets.has(stopId) || manuallyChanged.has(stopId)) return { ...slot };
    const requestedTime = PLANNER_AGENT_DEMO_TIMES[stopId];
    if (!requestedTime) return { ...slot };

    let nextMinutes = timeToMinutes(requestedTime);
    while (occupiedMinutes.has(nextMinutes) && nextMinutes < 24 * 60 - 15) {
      nextMinutes += 15;
    }
    occupiedMinutes.add(nextMinutes);
    return { ...slot, time: formatMinutes(nextMinutes) };
  }));
}

export function applyPlannerAgentDemoStep({
  timelineSlots,
  constraints,
  step,
  manuallyChangedStopIds = [],
}) {
  const currentSlots = timelineSlots.map((slot) => ({ ...slot }));
  const currentConstraints = constraints.map((constraint) => ({ ...constraint }));

  if (step.kind === "constraint") {
    return {
      timelineSlots: sortSlots(currentSlots),
      constraints: currentConstraints.some((constraint) => constraint.id === "saturday-morning")
        ? currentConstraints
        : [
          ...currentConstraints,
          {
            id: "saturday-morning",
            label: "周六 09:00—12:00 有事",
          },
        ],
      changedStopIds: [],
      activeStopId: null,
      scrollMinute: 9 * 60,
    };
  }

  if (step.kind === "protect") {
    return {
      timelineSlots: sortSlots(currentSlots),
      constraints: currentConstraints,
      changedStopIds: [],
      activeStopId: null,
      scrollMinute: null,
    };
  }

  if (step.kind === "validate") {
    return {
      timelineSlots: sortSlots(currentSlots),
      constraints: currentConstraints,
      changedStopIds: [],
      activeStopId: null,
      scrollMinute: null,
    };
  }

  const manuallyChanged = new Set([...manuallyChangedStopIds].map(Number));
  const targetStopIds = step.kind === "move"
    ? step.stopIds
      .map(Number)
      .filter((stopId) => currentSlots.some((slot) => Number(slot.stopId) === stopId))
    : [];
  const changedStopIds = targetStopIds.filter((stopId) => !manuallyChanged.has(Number(stopId)));

  return {
    timelineSlots: scheduleStops(currentSlots, targetStopIds, manuallyChanged),
    constraints: currentConstraints,
    changedStopIds,
    activeStopId: null,
    scrollMinute: null,
  };
}

export function buildPlannerAgentDemoOperations({
  phase,
  stepIndex,
  previewOperation,
}) {
  return PLANNER_AGENT_DEMO_STEPS.map((step, index) => ({
    ...step,
    status: index < stepIndex || phase === "completed"
      ? "APPLIED"
      : previewOperation?.operationId === step.operationId
        ? "STARTED"
        : "PENDING",
  }));
}
