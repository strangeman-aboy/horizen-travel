const snapUpToQuarterHour = (time) => {
  const [hours, minutes] = String(time ?? "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "09:00";
  const snapped = Math.min(23 * 60 + 45, Math.ceil((hours * 60 + minutes) / 15) * 15);
  return `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`;
};

const durationLabel = (minutes) => `${Math.max(15, Math.round(Number(minutes) || 60))} 分钟`;

/**
 * Adapts one generated day to Knot's current single-day planner contract.
 * The generated result can still display multiple days; the canvas receives
 * the chosen day because its persisted stop schema currently has no dayIndex.
 */
export function buildPlannerStateFromPersonalizedRoute(route, catalogPlaces, day = 1) {
  const routeStops = Array.isArray(route?.stops)
    ? route.stops.filter((stop) => stop.day === day)
    : [];
  if (!routeStops.length) return null;

  const generatedById = new Map(routeStops.map((stop) => [String(stop.id), stop]));
  const places = (Array.isArray(catalogPlaces) ? catalogPlaces : []).map((place) => {
    const generated = generatedById.get(String(place.id));
    if (!generated) return { ...place };
    return {
      ...place,
      time: generated.scheduledTime,
      duration: durationLabel(generated.durationMinutes),
      durationMinutes: generated.durationMinutes,
      personalityReason: generated.reason,
      personalityFit: generated.fit,
    };
  });

  const timelineSlots = routeStops.map((stop, index) => ({
    slotId: `${route.id}-day-${day}-slot-${index + 1}`,
    stopId: stop.id,
    time: snapUpToQuarterHour(stop.scheduledTime),
  }));
  const routeTitle = String(route?.title ?? "").replace(
    /·\s*\d+日\s*·/u,
    `· 第 ${day} 天 ·`,
  );

  return {
    selectedRoute: {
      ...route,
      id: `${route.id}-day-${day}`,
      parentRouteId: route.id,
      activeDay: day,
      title: routeTitle || `${route.city ?? "北京"} · 第 ${day} 天 · 人格专属路线`,
      days: `第 ${day} 天 · ${routeStops.length} 站`,
      highlights: routeStops.map((stop) => stop.name),
      stops: routeStops,
      daysPlan: [{
        day,
        stops: routeStops.map((stop) => stop.id),
      }],
      pace: route?.pace ? { ...route.pace, days: 1 } : route?.pace,
    },
    places,
    timelineSlots,
    plannerState: {
      constraints: [],
      transportModeOverrides: {},
    },
  };
}
