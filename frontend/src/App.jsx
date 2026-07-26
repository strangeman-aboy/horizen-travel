import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { RouteDetailPage } from "./RouteDetailPage";
import { XiaohongshuImportShelf } from "./integrations/XiaohongshuImportShelf.jsx";
import { MeituanBookingPanel } from "./integrations/MeituanBookingPanel.jsx";
import { InteractiveRouteMap } from "./map/InteractiveRouteMap.jsx";
import { usePlannerAgentRun } from "./agent/usePlannerAgentRun.js";
import {
  PLANNER_AGENT_DEMO_PROMPT,
  PLANNER_AGENT_DEMO_STEPS,
  applyPlannerAgentDemoStep,
  buildPlannerAgentDemoOperations,
  createPlannerAgentDemoState,
} from "./agent/plannerAgentDemo.js";
import {
  buildConfirmedTripPayload,
  buildPlannerStateFromImport,
  buildPlannerStateFromTrip,
  createConfirmedTrip,
  getTrip,
  manualScheduleStatus,
  mergeTripReceiptWithSubmittedSnapshot,
  recordExecutionEvent,
  saveTripSchedule,
} from "./api/travelApi.js";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookmarkIcon,
  CalendarIcon,
  CheckCircledIcon,
  ChevronRightIcon,
  ClockIcon,
  Cross2Icon,
  DashboardIcon,
  DotsHorizontalIcon,
  DragHandleDots2Icon,
  DrawingPinIcon,
  FileTextIcon,
  GlobeIcon,
  HomeIcon,
  LapTimerIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  MixerHorizontalIcon,
  PaperPlaneIcon,
  Pencil1Icon,
  PersonIcon,
  PlusIcon,
  ReaderIcon,
  ReloadIcon,
  SewingPinIcon,
  Share1Icon,
  SunIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import {
  BicycleIcon,
  CarProfileIcon,
  PersonSimpleWalkIcon,
} from "@phosphor-icons/react";

const stops = [
  {
    id: 1,
    time: "09:00",
    duration: "75 分钟",
    name: "雍和宫",
    type: "古建与祈福",
    image: "/assets/beijing-lama-temple.png",
    note: "把人流较少的清晨留给雍和宫，先看红墙金瓦，也让一天从更安静的节奏开始。",
    travel: "步行 8 分钟",
    cost: "门票 ¥25",
    libraryTitle: "雍和宫红墙晨光",
    libraryCreator: "京城慢游",
    libraryAvatar: "/assets/creator-chen.png",
    libraryTag: "文化",
    libraryTone: "culture",
    position: { left: "81%", top: "10%" },
  },
  {
    id: 2,
    time: "10:30",
    duration: "90 分钟",
    name: "五道营胡同",
    type: "咖啡与早午餐",
    image: "/assets/beijing-wudaoying.png",
    note: "早午餐、咖啡和独立小店集中在同一条胡同，不额外折返，也给上午留出弹性。",
    travel: "步行 8 分钟",
    cost: "约 ¥68",
    libraryTitle: "五道营胡同咖啡",
    libraryCreator: "胡同散步者",
    libraryAvatar: "/assets/creator-qian.png",
    libraryTag: "在地",
    libraryTone: "local",
    position: { left: "71%", top: "16%" },
  },
  {
    id: 3,
    time: "12:15",
    duration: "60 分钟",
    name: "国子监街",
    type: "古建与街巷",
    image: "/assets/beijing-guozijian.png",
    note: "沿着灰砖红门慢慢走完国子监街，把牌楼、院落与街区日常放在同一段步行里。",
    travel: "地铁 22 分钟",
    cost: "免费",
    libraryTitle: "国子监街古建漫步",
    libraryCreator: "古建笔记",
    libraryAvatar: "/assets/creator-chen.png",
    libraryTag: "文化",
    libraryTone: "culture",
    position: { left: "62%", top: "27%" },
  },
  {
    id: 4,
    time: "14:30",
    duration: "90 分钟",
    name: "东四艺文街区",
    type: "当代艺术",
    image: "/assets/beijing-guardian-art.png",
    note: "下午进入东四一带的艺文空间看展，路线会保留预约时段，并把具体展讯标记为出发前再次核验。",
    travel: "步行 16 分钟",
    cost: "展览约 ¥80",
    libraryTitle: "东四艺文街区看展",
    libraryCreator: "艺文地图",
    libraryAvatar: "/assets/creator-lin.png",
    libraryTag: "艺术与文化",
    libraryTone: "art",
    position: { left: "59%", top: "43%" },
  },
  {
    id: 5,
    time: "16:40",
    duration: "80 分钟",
    name: "景山公园",
    type: "中轴线日落",
    image: "/assets/beijing-jingshan.png",
    note: "把傍晚留给景山，从高处看北京中轴线；日落时间变化会在出发当天重新提示。",
    travel: "步行 22 分钟",
    cost: "门票 ¥2",
    libraryTitle: "景山中轴线日落",
    libraryCreator: "中轴线观察",
    libraryAvatar: "/assets/creator-lin.png",
    libraryTag: "自然",
    libraryTone: "nature",
    position: { left: "38%", top: "82%" },
  },
  {
    id: 6,
    time: "18:40",
    duration: "90 分钟",
    name: "什刹海",
    type: "湖畔夜色",
    image: "/assets/beijing-shichahai.png",
    note: "沿湖边散步和吃晚饭作为自然收尾，不再塞入新的远距离景点。",
    travel: "行程结束",
    cost: "约 ¥48",
    libraryTitle: "什刹海湖畔夜色",
    libraryCreator: "湖畔夜游",
    libraryAvatar: "/assets/creator-qian.png",
    libraryTag: "夜色",
    libraryTone: "night",
    position: { left: "27%", top: "43%" },
  },
  {
    id: 7,
    time: "13:15",
    duration: "100 分钟",
    name: "故宫博物院",
    type: "宫城与中轴线",
    image: "/assets/beijing-forbidden-city-dashboard.png",
    note: "从午门进入宫城，在午后光线里看屋脊与院落；需要提前预约，适合作为可自由加入的备选节点。",
    travel: "步行 18 分钟",
    cost: "门票 ¥60",
    libraryTitle: "故宫午后屋脊",
    libraryCreator: "京城慢游",
    libraryAvatar: "/assets/creator-chen.png",
    libraryTag: "文化",
    libraryTone: "culture",
    position: { left: "47%", top: "58%" },
  },
  {
    id: 8,
    time: "17:20",
    duration: "70 分钟",
    name: "钟鼓楼胡同",
    type: "老城与街巷",
    image: "/assets/beijing-hero-hutong.png",
    note: "从鼓楼周边慢慢走进旧城胡同，适合补进行程空出来的傍晚时间，也能自然衔接什刹海。",
    travel: "步行 12 分钟",
    cost: "免费",
    libraryTitle: "钟鼓楼胡同漫步",
    libraryCreator: "胡同散步者",
    libraryAvatar: "/assets/creator-qian.png",
    libraryTag: "在地",
    libraryTone: "local",
    position: { left: "32%", top: "26%" },
  },
];

const defaultPlaceDetails = {
  1: {
    sourceStopId: "route-stop-lama-temple",
    placeId: "place-lama-temple",
    address: "北京市东城区雍和宫大街12号",
    latitude: 39.953377859,
    longitude: 116.42370918,
    coordSystem: "BD09LL",
    providerRefs: [],
  },
  2: {
    sourceStopId: "route-stop-wudaoying",
    placeId: "place-wudaoying",
    address: "北京市东城区五道营胡同",
    latitude: 39.954949461,
    longitude: 116.415124973,
    coordSystem: "BD09LL",
    providerRefs: [],
  },
  3: {
    sourceStopId: "route-stop-guozijian",
    placeId: "place-guozijian",
    address: "北京市东城区国子监街",
    latitude: 39.951771858,
    longitude: 116.418891837,
    coordSystem: "BD09LL",
    providerRefs: [],
  },
  4: {
    sourceStopId: "route-stop-dongsi-art",
    placeId: "place-dongsi-art",
    address: "北京市东城区东四片区",
    latitude: 39.92988923,
    longitude: 116.416619483,
    coordSystem: "BD09LL",
    providerRefs: [],
  },
  5: {
    sourceStopId: "route-stop-jingshan",
    placeId: "place-jingshan",
    address: "北京市西城区景山西街44号",
    latitude: 39.93227005,
    longitude: 116.402818007,
    coordSystem: "BD09LL",
    providerRefs: [],
  },
  6: {
    sourceStopId: "route-stop-shichahai",
    placeId: "place-shichahai",
    address: "北京市西城区什刹海街道",
    latitude: 39.94223553,
    longitude: 116.397197669,
    coordSystem: "BD09LL",
    providerRefs: [],
  },
  7: {
    sourceStopId: "route-stop-forbidden-city",
    placeId: "place-forbidden-city",
    address: "北京市东城区景山前街4号",
    latitude: 39.924091,
    longitude: 116.403414,
    coordSystem: "BD09LL",
    providerRefs: [],
  },
  8: {
    sourceStopId: "route-stop-bell-drum-towers",
    placeId: "place-bell-drum-towers",
    address: "北京市东城区钟楼湾胡同临字9号",
    latitude: 39.946598,
    longitude: 116.399153,
    coordSystem: "BD09LL",
    providerRefs: [],
  },
};

const defaultTravelPlaces = stops.map((stop) => ({
  ...stop,
  ...defaultPlaceDetails[stop.id],
  clientStopId: String(stop.id),
  durationMinutes: Number.parseInt(stop.duration, 10),
}));

const LAST_TRIP_STORAGE_KEY = "route-story:last-trip-id:v1";
const LOCAL_TRIP_PREFIX = "local-demo-trip";
const STATIC_DEMO_MODE = typeof __STATIC_DEMO__ !== "undefined" && __STATIC_DEMO__;

const isUnavailableTripServiceError = (error) => (
  ["API_UNREACHABLE", "API_TIMEOUT"].includes(error?.code)
  || [404, 502, 503, 504].includes(Number(error?.status))
);

const isLoopbackPreview = () => (
  STATIC_DEMO_MODE
  || (
    typeof window !== "undefined"
    && (
      window.location.protocol === "file:"
      || ["127.0.0.1", "::1"].includes(window.location.hostname)
    )
  )
);

const createLocalTripSession = () => {
  const suffix = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  return {
    tripId: `${LOCAL_TRIP_PREFIX}-${suffix}`,
    revisionId: `local-revision-${suffix}`,
    revision: 0,
    status: "CONFIRMED",
    savedAt: new Date().toISOString(),
    localOnly: true,
  };
};

const mergeWithDefaultPlaces = (routePlaces) => {
  const importedIdentifiers = new Set(routePlaces.map((place) => String(place.id)));
  return [
    ...routePlaces,
    ...defaultTravelPlaces.filter((place) => !importedIdentifiers.has(String(place.id))),
  ];
};

const routes = [
  {
    id: "beijing-hutong-art",
    title: "北京胡同与艺文一日",
    city: "北京",
    days: "1 天 · 6 站",
    tag: "慢旅行",
    creator: "陈以欢",
    followers: "2.8 万关注",
    budget: "¥260–380",
    image: "/assets/beijing-hero-hutong.png",
    avatar: "/assets/creator-chen.png",
    summary: "从雍和宫与五道营出发，走过胡同、艺文空间和北京中轴线，把日落留给景山。",
    highlights: ["雍和宫", "五道营胡同", "国子监街", "东四艺文街区"],
    featured: true,
  },
  {
    id: "heritage-day",
    title: "北京中轴线登高一日",
    city: "北京",
    days: "1 天 · 5 站",
    tag: "城市文化",
    creator: "林川",
    followers: "1.2 万关注",
    budget: "¥140–240",
    image: "/assets/beijing-jingshan.png",
    avatar: "/assets/creator-lin.png",
    summary: "从钟鼓楼一路走到景山，把城门、屋脊与北京的纵深放进一条路线。",
    highlights: ["钟鼓楼", "地安门", "景山公园"],
  },
  {
    id: "coffee-night",
    title: "胡同咖啡与什刹海夜色",
    city: "北京",
    days: "半日 · 4 站",
    tag: "傍晚出发",
    creator: "茜茜",
    followers: "8 千关注",
    budget: "¥120–220",
    image: "/assets/beijing-wudaoying.png",
    avatar: "/assets/creator-qian.png",
    summary: "从五道营的一杯咖啡开始，沿胡同走到什刹海，把湖边夜色留作最后一站。",
    highlights: ["五道营胡同", "鼓楼", "什刹海"],
  },
  {
    id: "summer-palace-lake",
    title: "颐和园湖畔慢游一日",
    city: "北京·海淀",
    days: "1 天 · 6 站",
    tag: "皇家园林",
    creator: "周岚",
    followers: "1.9 万关注",
    budget: "¥180–320",
    image: "/assets/beijing-summer-palace-dashboard.png",
    avatar: "/assets/creator-qian.png",
    summary: "从昆明湖东岸慢慢走到后山，把长廊、借景与落日留在同一条不赶路的园林路线里。",
    highlights: ["东宫门", "长廊", "佛香阁", "昆明湖"],
  },
  {
    id: "mutianyu-hike",
    title: "慕田峪长城轻徒步",
    city: "北京·怀柔",
    days: "1 天 · 4 站",
    tag: "近郊徒步",
    creator: "许野",
    followers: "3.1 万关注",
    budget: "¥320–520",
    image: "/assets/beijing-mutianyu-dashboard.png",
    avatar: "/assets/creator-lin.png",
    summary: "避开最拥挤的时段，从山脚接驳到敌楼徒步，再把傍晚留给山谷里的村落晚餐。",
    highlights: ["慕田峪村", "十四号敌楼", "正关台"],
  },
  {
    id: "lama-temple-morning",
    title: "红墙古建与雍和晨光",
    city: "北京·东城",
    days: "半日 · 4 站",
    tag: "古建摄影",
    creator: "阿遥",
    followers: "9 千关注",
    budget: "¥90–180",
    image: "/assets/beijing-lama-temple.png",
    avatar: "/assets/creator-chen.png",
    summary: "趁晨光沿红墙进入雍和宫，再到国子监与孔庙，把古建细节和安静街巷一次收进镜头。",
    highlights: ["雍和宫", "孔庙", "国子监街"],
  },
  {
    id: "forbidden-city-rooftops",
    title: "故宫屋脊与东华门晚风",
    city: "北京·东城",
    days: "1 天 · 5 站",
    tag: "中轴漫游",
    creator: "陆深",
    followers: "2.4 万关注",
    budget: "¥180–300",
    image: "/assets/beijing-forbidden-city-dashboard.png",
    avatar: "/assets/creator-lin.png",
    summary: "从午门穿过宫城，在屋脊、角楼和城墙光影之间慢慢行走，最后从东华门迎接晚风。",
    highlights: ["午门", "太和殿", "珍宝馆", "东华门"],
    wide: true,
  },
  {
    id: "art-district-night",
    title: "798 画廊与酒仙桥新夜",
    city: "北京·朝阳",
    days: "半日 · 5 站",
    tag: "当代艺术",
    creator: "南希",
    followers: "1.6 万关注",
    budget: "¥160–280",
    image: "/assets/beijing-guardian-art.png",
    avatar: "/assets/creator-qian.png",
    summary: "从下午的展览和工业建筑开始，穿过酒仙桥社区，把晚餐与夜间艺术空间排在同一条动线上。",
    highlights: ["798 艺术区", "草场地", "酒仙桥", "亮马河"],
    wide: true,
  },
];

const initialLanes = {
  morning: [1, 2],
  afternoon: [3, 4],
  evening: [5, 6],
};

const itineraryTimes = ["09:00", "10:30", "12:15", "13:45", "15:45", "17:30"];

const initialTimelineSlots = itineraryTimes.map((time, index) => ({
  slotId: `slot-${index + 1}`,
  time,
  stopId: index + 1,
}));

const cloneInitialTimelineSlots = () => initialTimelineSlots.map((slot) => ({ ...slot }));
const createEmptyPlannerState = () => ({
  constraints: [],
  transportModeOverrides: {},
});

const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const TIMELINE_DAY_MINUTES = 24 * 60;
const TIMELINE_SNAP_MINUTES = 15;
const TIMELINE_MAX_ITEM_MINUTES = TIMELINE_DAY_MINUTES - TIMELINE_SNAP_MINUTES;
const TIMELINE_HOUR_WIDTH = 105;
const TIMELINE_CARD_WIDTH = 144;
const TIMELINE_CARD_HEIGHT = 220;
const TIMELINE_EDGE_GUTTER = 88;
const TIMELINE_CARD_GAP = 18;
const TIMELINE_TRACK_GAP = 104;
const TIMELINE_CARD_TOP = 112;
const TIMELINE_MAX_VISIBLE_DURATION_MINUTES = 120;
const TIMELINE_ZOOM_DEFAULT = 1;
const TIMELINE_ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5];
const TIMELINE_ZOOM_MIN = TIMELINE_ZOOM_LEVELS[0];
const TIMELINE_ZOOM_MAX = TIMELINE_ZOOM_LEVELS[TIMELINE_ZOOM_LEVELS.length - 1];

const clampTimelineZoom = (zoom) => Math.max(
  TIMELINE_ZOOM_MIN,
  Math.min(zoom, TIMELINE_ZOOM_MAX),
);

const getTimelineMetrics = (requestedZoom = TIMELINE_ZOOM_DEFAULT) => {
  const zoom = clampTimelineZoom(requestedZoom);
  const hourWidth = TIMELINE_HOUR_WIDTH * zoom;
  const pxPerMinute = hourWidth / 60;
  const cardScale = Math.min(1.12, Math.max(0.5, 0.33 + zoom * 0.67));
  const cardWidth = Math.round(TIMELINE_CARD_WIDTH * cardScale);
  const cardHeight = Math.round(TIMELINE_CARD_HEIGHT * cardScale);
  const cardGap = Math.max(8, Math.round(TIMELINE_CARD_GAP * cardScale));
  const minCardWidth = Math.max(36, Math.round(70 * cardScale));
  const maxCardWidth = Math.max(minCardWidth, Math.round(176 * cardScale));
  const edgeGutter = Math.ceil(Math.max(
    TIMELINE_EDGE_GUTTER,
    maxCardWidth / 2 + 24,
    TIMELINE_MAX_VISIBLE_DURATION_MINUTES * pxPerMinute / 2 + 24,
  ));
  const isOverview = zoom <= 0.4;
  const durationBarHeight = isOverview ? 6 : 28;
  const routeLaneOffset = isOverview
    ? 28
    : Math.max(70, Math.round(92 * cardScale));
  const transportIconSize = isOverview ? 28 : 40;
  const trackGap = isOverview
    ? Math.max(54, Math.round(TIMELINE_TRACK_GAP * cardScale))
    : routeLaneOffset + transportIconSize + 18;
  const axisTypeScale = Math.min(1.1, Math.max(0.72, Math.sqrt(zoom)));

  return {
    zoom,
    hourWidth,
    quarterWidth: hourWidth / 4,
    pxPerMinute,
    edgeGutter,
    cardWidth,
    minCardWidth,
    maxCardWidth,
    cardHeight,
    cardImageHeight: Math.round(108 * cardScale),
    cardRadius: Math.max(10, Math.round(17 * cardScale)),
    cardInnerPadding: Math.max(4, Math.round(7 * cardScale)),
    cardCopyPadding: Math.max(5, Math.round(8 * cardScale)),
    cardCopyGap: Math.max(2, Math.round(5 * cardScale)),
    cardTitleFontSize: Math.max(11, Math.min(16, 14 * cardScale)),
    cardMetaFontSize: 11,
    cardTimeFontSize: 11,
    cardTimeMinWidth: Math.max(38, Math.round(48 * cardScale)),
    cardTimePaddingY: Math.max(4, Math.round(6 * cardScale)),
    cardTimePaddingX: Math.max(5, Math.round(8 * cardScale)),
    durationLaneOffset: isOverview ? 8 : Math.max(10, Math.round(12 * cardScale)),
    durationBarHeight,
    routeLaneOffset,
    transportIconSize,
    axisFontSize: Math.max(11, 11 * axisTypeScale),
    annotationFontSize: Math.max(11, 9 * axisTypeScale),
    cardGap,
    trackGap,
    cardTop: TIMELINE_CARD_TOP,
    surfaceWidth: edgeGutter * 2 + TIMELINE_DAY_MINUTES * pxPerMinute,
    minCardGapMinutes: Math.ceil((cardWidth + cardGap) / pxPerMinute),
  };
};

const formatTimelineMinute = (totalMinutes) => {
  const normalized = Math.max(0, Math.min(Math.round(totalMinutes), TIMELINE_DAY_MINUTES));
  if (normalized === TIMELINE_DAY_MINUTES) return "24:00";
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
};

const getStopDurationMinutes = (stop) => {
  const parsed = Number.parseInt(stop?.duration?.match(/\d+/)?.[0] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
};

const formatDurationLabel = (minutes) => {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`;
};

const timelineTransportPairProfiles = {
  "1>2": {
    mode: "walk", label: "步行", minutes: 8, distance: "1.1 km", estimatedCost: "免费",
  },
  "2>3": {
    mode: "taxi", label: "打车", minutes: 8, distance: "4.8 km", estimatedCost: "约 ¥18–24",
  },
  "2>4": {
    mode: "taxi", label: "打车", minutes: 8, distance: "4.8 km", estimatedCost: "约 ¥18–24",
  },
  "2>7": {
    mode: "taxi", label: "打车", minutes: 18, distance: "5.5 km", estimatedCost: "约 ¥21–28",
  },
  "3>4": {
    mode: "walk", label: "步行", minutes: 22, distance: "1.6 km", estimatedCost: "免费",
  },
  "4>5": {
    mode: "taxi", label: "打车", minutes: 16, distance: "5.8 km", estimatedCost: "约 ¥21–28",
  },
  "5>6": {
    mode: "walk", label: "步行", minutes: 22, distance: "2.0 km", estimatedCost: "免费",
  },
  "7>4": {
    mode: "walk", label: "步行", minutes: 18, distance: "1.2 km", estimatedCost: "免费",
  },
};

const TIMELINE_SHORT_TRANSPORT_DISTANCE_KM = 2.5;
const TIMELINE_TRANSPORT_MODE_LABELS = {
  walk: "步行",
  bike: "骑行",
  taxi: "打车",
};

const getTimelineTransportProfile = (fromStopId, toStopId, preferredMode) => {
  const pairKey = `${fromStopId}>${toStopId}`;
  let baseProfile = timelineTransportPairProfiles[pairKey];

  if (!baseProfile) {
    const stopGap = Math.max(1, Math.abs(Number(toStopId) - Number(fromStopId)));
    const baseMode = stopGap >= 3 ? "taxi" : "walk";
    const distanceKm = baseMode === "taxi"
      ? Number((2.4 + stopGap * 0.7).toFixed(1))
      : Number((0.7 + stopGap * 0.32).toFixed(1));
    const minutes = baseMode === "taxi"
      ? Math.max(8, Math.round(distanceKm * 2.5))
      : Math.max(8, Math.round(distanceKm * 13));
    const estimatedCost = baseMode === "taxi"
      ? `约 ¥${Math.round(13 + Math.max(0, distanceKm - 3) * 2.3)}–${
        Math.round(18 + Math.max(0, distanceKm - 3) * 3)
      }`
      : "免费";

    baseProfile = {
      mode: baseMode,
      label: baseMode === "taxi" ? "打车" : "步行",
      minutes,
      distance: `${distanceKm.toFixed(1)} km`,
      estimatedCost,
    };
  }

  const distanceKm = Number.parseFloat(baseProfile.distance);
  const availableModes = distanceKm <= TIMELINE_SHORT_TRANSPORT_DISTANCE_KM
    ? ["walk", "bike"]
    : ["taxi", "bike"];
  const mode = availableModes.includes(preferredMode)
    ? preferredMode
    : availableModes[0];

  if (mode === baseProfile.mode) {
    return {
      ...baseProfile,
      pairKey,
      distanceKm,
      availableModes,
    };
  }

  if (mode === "bike") {
    return {
      ...baseProfile,
      pairKey,
      mode,
      label: "骑行",
      minutes: Math.max(5, Math.round(distanceKm * 4.5)),
      estimatedCost: "约 ¥1.5–3",
      distanceKm,
      availableModes,
    };
  }

  const minutes = mode === "taxi"
    ? Math.max(8, Math.round(distanceKm * 2.5))
    : Math.max(8, Math.round(distanceKm * 13));
  const estimatedCost = mode === "taxi"
    ? `约 ¥${Math.round(13 + Math.max(0, distanceKm - 3) * 2.3)}–${
      Math.round(18 + Math.max(0, distanceKm - 3) * 3)
    }`
    : "免费";

  return {
    ...baseProfile,
    pairKey,
    mode,
    label: mode === "taxi" ? "打车" : "步行",
    minutes,
    estimatedCost,
    distanceKm,
    availableModes,
  };
};

const getEstimatedCostRange = (estimatedCost) => {
  const match = String(estimatedCost).match(
    /¥\s*(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?/,
  );
  if (!match) return { min: 0, max: 0 };
  const firstAmount = Number(match[1]);
  const secondAmount = Number(match[2] ?? match[1]);
  return {
    min: Math.min(firstAmount, secondAmount),
    max: Math.max(firstAmount, secondAmount),
  };
};

const formatEstimatedAmount = (amount) => (
  Number.isInteger(amount) ? String(amount) : amount.toFixed(1)
);

const snapTimelineMinute = (totalMinutes) => (
  Math.max(
    0,
    Math.min(
      Math.round(totalMinutes / TIMELINE_SNAP_MINUTES) * TIMELINE_SNAP_MINUTES,
      TIMELINE_MAX_ITEM_MINUTES,
    ),
  )
);

const timelineMinuteToX = (minutes, metrics) => (
  metrics.edgeGutter + minutes * metrics.pxPerMinute
);

const sortTimelineSlots = (slots) => [...slots].sort((left, right) => (
  timeToMinutes(left.time) - timeToMinutes(right.time)
  || left.slotId.localeCompare(right.slotId)
));

const createTimelineSlotId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `slot-${crypto.randomUUID()}`;
  }
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

const navItems = [
  { id: "discover", label: "首页", icon: HomeIcon },
  { id: "canvas", label: "规划画布", icon: MagicWandIcon },
  { id: "inspiration", label: "附近灵感", icon: DrawingPinIcon },
  { id: "dashboard", label: "出行模式", icon: PaperPlaneIcon },
];

const navPageAliases = {
  "route-detail": "discover",
  navigate: "dashboard",
};

const topbarPageCopy = {
  dashboard: { eyebrow: "我的旅程", title: "出行模式", icon: PaperPlaneIcon },
  "route-detail": { eyebrow: "首页 · 路线灵感", title: "创作者路线详情", icon: ReaderIcon },
  canvas: { eyebrow: "旅行规划", title: "规划画布", icon: MagicWandIcon },
  inspiration: { eyebrow: "就在附近", title: "附近灵感", icon: DrawingPinIcon },
  navigate: { eyebrow: "出行模式", title: "实时行程", icon: PaperPlaneIcon },
};

const dashboardPlaces = [
  {
    id: "forbidden-city",
    name: "故宫博物院",
    area: "东城区",
    image: "/assets/beijing-forbidden-city-dashboard.png",
    day: "第 1 天 · 上午",
    previewTime: "09:00",
    summary: "穿越历史的晨光",
    position: { left: "36%", top: "63%" },
  },
  {
    id: "summer-palace",
    name: "颐和园",
    area: "海淀区",
    image: "/assets/beijing-summer-palace-dashboard.png",
    day: "第 2 天 · 上午",
    previewTime: "12:30",
    summary: "沿昆明湖慢慢走",
    position: { left: "25%", top: "37%" },
  },
  {
    id: "mutianyu",
    name: "慕田峪长城",
    area: "怀柔区",
    image: "/assets/beijing-mutianyu-dashboard.png",
    day: "第 3 天 · 全天",
    previewTime: "15:00",
    summary: "在山脊上读北京",
    position: { left: "78%", top: "14%" },
  },
  {
    id: "shichahai",
    name: "什刹海",
    area: "西城区",
    image: "/assets/beijing-shichahai.png",
    day: "第 4 天 · 傍晚",
    previewTime: "18:30",
    summary: "沿湖收起一天脚步",
    position: { left: "60%", top: "47%" },
  },
];

const dashboardNotes = [
  {
    title: "把日落留给景山",
    body: "故宫闭馆后从神武门向北步行，傍晚登高看中轴线，时间更从容。",
    meta: "第 2 天 · 景山",
  },
  {
    title: "颐和园从西门进",
    body: "先走西堤，再沿昆明湖到佛香阁，避开上午东宫门一带的集中客流。",
    meta: "第 3 天 · 颐和园",
  },
  {
    title: "长城日准备轻装",
    body: "只带水、防晒和薄外套；早餐提前解决，保留山上慢走和停留的余量。",
    meta: "第 4 天 · 慕田峪",
  },
];

const dashboardBookings = [
  {
    title: "故宫预约",
    detail: "10 月 12 日 · 09:30",
    status: "已确认",
    image: "/assets/beijing-forbidden-city-dashboard.png",
  },
  {
    title: "北京四合院酒店",
    detail: "10 月 12—16 日 · 4 晚",
    status: "已确认",
    image: "/assets/beijing-hero-hutong.png",
  },
];

function AppChrome({
  page,
  onNavigate,
  onToast,
  searchQuery,
  onSearchQueryChange,
  onSearchSubmit,
}) {
  const activeNavId = navPageAliases[page] ?? page;
  const showSearch = page === "discover" || page === "dashboard";
  const showFilter = page === "discover";
  const showGlobalTopbar = !["canvas", "inspiration", "dashboard"].includes(page);
  const topbarCopy = topbarPageCopy[page];
  const TopbarIcon = topbarCopy?.icon ?? MagnifyingGlassIcon;

  return (
    <>
      <aside className="app-sidebar" aria-label="串旅行规划全局导航">
        <div className="sidebar-main">
          <button
            className="brand"
            type="button"
            onClick={() => onNavigate("discover")}
            aria-label="串 Knot · 返回首页"
          >
            <span className="brand-mark brand-mark-chuan" aria-hidden="true">
              <img src="/assets/chuan-knot-symbol.png" alt="" draggable="false" />
            </span>
            <span className="brand-wordmark">
              <strong>串</strong>
              <small>Knot</small>
            </span>
          </button>

          <nav className="sidebar-nav" aria-label="产品主导航">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={activeNavId === item.id ? "active" : ""}
                  onClick={() => onNavigate(item.id)}
                  aria-current={activeNavId === item.id ? "page" : undefined}
                  title={item.label}
                >
                  <Icon />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-footer">
          <button
            className="sidebar-city"
            type="button"
            onClick={() => onToast("当前演示城市：北京")}
            title="当前城市：北京"
          >
            <DrawingPinIcon />
            <span>
              <small>当前城市</small>
              <strong>北京</strong>
            </span>
            <ChevronRightIcon />
          </button>
          <button
            className="sidebar-profile"
            type="button"
            onClick={() => onToast("「我」的页面将在下一步继续设计")}
            title="我"
          >
            <img src="/assets/creator-chen.png" alt="" />
            <span>
              <strong>我</strong>
              <small>旅行档案</small>
            </span>
          </button>
        </div>
      </aside>

      {showGlobalTopbar ? (
        <header className={`app-topbar ${page === "dashboard" ? "dashboard-topbar" : ""}`}>
        {showSearch ? (
          <form
            className="topbar-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              onSearchSubmit();
            }}
          >
            <label>
              <MagnifyingGlassIcon />
              <input
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                placeholder={page === "dashboard" ? "搜索行程中的地点、区域或笔记" : "搜索城市、路线或创作者"}
                aria-label={page === "dashboard" ? "搜索当前行程" : "搜索路线"}
              />
            </label>
            <button type="submit" className="topbar-search-submit" aria-label="开始搜索">
              <MagnifyingGlassIcon />
            </button>
          </form>
        ) : (
          <div className="topbar-page-context">
            <span><TopbarIcon /></span>
            <div>
              <small>{topbarCopy?.eyebrow}</small>
              <strong>{topbarCopy?.title}</strong>
            </div>
          </div>
        )}

        {page === "dashboard" ? null : (
          <div className="topbar-actions">
          {showFilter ? (
            <button
              type="button"
              className="topbar-filter"
              onClick={() => onToast("可按天数、预算、节奏和同行人筛选")}
            >
              <MixerHorizontalIcon />
              <span>筛选</span>
            </button>
          ) : (
            <span className="topbar-location"><DrawingPinIcon />北京</span>
          )}
          </div>
        )}
        </header>
      ) : null}
    </>
  );
}

function NearbyInspirationPage({ onToast }) {
  const [hoveredStopId, setHoveredStopId] = useState(null);
  const [selectedStopId, setSelectedStopId] = useState(stops[0]?.id ?? null);
  const [detailStopId, setDetailStopId] = useState(null);
  const [inspirationSearch, setInspirationSearch] = useState("");
  const [inspirationFilter, setInspirationFilter] = useState("all");
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const storyRefs = useRef(new Map());
  const storyScrollRef = useRef(null);
  const inspirationItems = useMemo(() => stops.map((stop) => ({
    stop,
    schedule: {
      slotId: `nearby-${stop.id}`,
      time: stop.time,
    },
    distance: nearbyDistanceByStopId[stop.id] ?? "2.0 km",
  })), []);
  const activeFilter = nearbyFeedFilters.find((filter) => filter.id === inspirationFilter)
    ?? nearbyFeedFilters[0];
  const normalizedSearch = inspirationSearch.trim().toLocaleLowerCase("zh-CN");
  const visibleItems = inspirationItems.filter(({ stop }) => {
    const searchableCopy = [
      stop.name,
      stop.type,
      stop.note,
      stop.libraryTitle,
      stop.libraryCreator,
      stop.libraryTag,
    ].join(" ").toLocaleLowerCase("zh-CN");
    return (
      activeFilter.matches(stop)
      && (!showSavedOnly || nearbySavedStopIds.has(stop.id))
      && (!normalizedSearch || searchableCopy.includes(normalizedSearch))
    );
  });
  const visibleSelectedStopId = visibleItems.some(({ stop }) => stop.id === selectedStopId)
    ? selectedStopId
    : visibleItems[0]?.stop.id ?? null;
  const displayStopId = visibleItems.some(({ stop }) => stop.id === hoveredStopId)
    ? hoveredStopId
    : visibleSelectedStopId;
  const visibleDetailStopId = visibleItems.some(({ stop }) => stop.id === detailStopId)
    ? detailStopId
    : null;

  const scrollStoryWithinFeed = (stopId) => {
    const story = storyRefs.current.get(stopId);
    const feed = storyScrollRef.current;
    if (!story || !feed) return;

    const storyBounds = story.getBoundingClientRect();
    const feedBounds = feed.getBoundingClientRect();
    const topOverflow = storyBounds.top - feedBounds.top - 12;
    const bottomOverflow = storyBounds.bottom - feedBounds.bottom + 12;
    const scrollDelta = topOverflow < 0 ? topOverflow : bottomOverflow > 0 ? bottomOverflow : 0;

    if (scrollDelta) {
      feed.scrollBy({ top: scrollDelta, behavior: "smooth" });
    }
  };

  const selectStop = (stopId) => {
    setSelectedStopId(stopId);
    setDetailStopId(stopId);
    setHoveredStopId(null);
    scrollStoryWithinFeed(stopId);
  };

  const closeStopDetail = () => {
    const returnFocusStopId = visibleDetailStopId;
    setDetailStopId(null);
    window.requestAnimationFrame(() => {
      storyRefs.current.get(returnFocusStopId)?.focus({ preventScroll: true });
    });
  };

  return (
    <main className="page nearby-inspiration-page" data-inspiration-page>
      <section className="result-explorer-shell nearby-explorer-shell">
        <section className="result-story-pane">
          <header className="result-story-toolbar nearby-story-toolbar">
            <label className="result-search-field">
              <MagnifyingGlassIcon />
              <input
                type="search"
                value={inspirationSearch}
                onChange={(event) => {
                  setInspirationSearch(event.target.value);
                  setDetailStopId(null);
                }}
                placeholder="搜索附近地点、灵感或创作者"
                aria-label="搜索附近灵感"
                data-inspiration-search
              />
            </label>
            <button
              type="button"
              className="result-distance-button"
              data-inspiration-radius
              onClick={() => onToast("当前展示你附近 2 公里内的灵感")}
            >
              <DrawingPinIcon />
              2 km 范围
            </button>
          </header>

          <div className="result-story-filters" aria-label="附近灵感分类">
            <div>
              {nearbyFeedFilters.map((filter) => (
                <button
                  type="button"
                  key={filter.id}
                  className={inspirationFilter === filter.id ? "active" : ""}
                  data-inspiration-filter={filter.id}
                  aria-pressed={inspirationFilter === filter.id}
                  onClick={() => {
                    setInspirationFilter(filter.id);
                    setHoveredStopId(null);
                    setDetailStopId(null);
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <span>{visibleItems.length} / {inspirationItems.length} 处</span>
          </div>

          <div
            ref={storyScrollRef}
            className="result-story-scroll"
            data-inspiration-feed-scroll
          >
            {visibleItems.length ? (
              <div className="result-story-grid">
                {visibleItems.map(({ stop, schedule, distance }, index) => {
                  const isSelected = visibleSelectedStopId === stop.id;
                  const isPreview = hoveredStopId === stop.id && visibleSelectedStopId !== stop.id;
                  const linkState = isPreview ? "preview" : isSelected ? "selected" : "idle";

                  return (
                    <button
                      type="button"
                      key={schedule.slotId}
                      ref={(node) => {
                        if (node) storyRefs.current.set(stop.id, node);
                        else storyRefs.current.delete(stop.id);
                      }}
                      className={`result-story-card ${isSelected ? "selected" : ""} ${isPreview ? "linked-hover" : ""}`}
                      data-inspiration-card-stop-id={stop.id}
                      data-link-state={linkState}
                      data-time={schedule.time}
                      data-distance={distance}
                      aria-haspopup="dialog"
                      aria-controls={visibleDetailStopId === stop.id ? "nearby-place-detail" : undefined}
                      aria-expanded={visibleDetailStopId === stop.id}
                      onMouseEnter={() => setHoveredStopId(stop.id)}
                      onMouseLeave={() => setHoveredStopId(null)}
                      onFocus={() => setHoveredStopId(stop.id)}
                      onBlur={() => setHoveredStopId(null)}
                      onClick={() => selectStop(stop.id)}
                      aria-pressed={isSelected}
                    >
                      <span className="result-story-image">
                        <img src={stop.image} alt={`${stop.name}附近灵感`} />
                        <span className="result-story-creator">
                          <img src={stop.libraryAvatar} alt="" />
                          <span>
                            <strong>{stop.libraryCreator}</strong>
                            <small>北京在地发现者</small>
                          </span>
                        </span>
                        <span className="result-story-location"><DrawingPinIcon />{stop.name}，北京</span>
                        <span className="result-story-order">{index + 1}</span>
                      </span>
                      <span className="result-story-copy">
                        <strong>{stop.libraryTitle}</strong>
                        <span>{stop.note}</span>
                        <small>
                          <em>#{stop.libraryTag}</em>
                          <span>{distance} · {stop.duration}</span>
                          <BookmarkIcon className={nearbySavedStopIds.has(stop.id) ? "saved" : ""} />
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="result-feed-empty">
                <MagnifyingGlassIcon />
                <strong>附近暂时没有匹配的灵感</strong>
                <span>试试搜索“胡同”“日落”，或切回全部。</span>
              </div>
            )}
          </div>
        </section>

        <NearbyInspirationMap
          items={visibleItems}
          displayStopId={displayStopId}
          selectedStopId={visibleSelectedStopId}
          detailStopId={visibleDetailStopId}
          showSavedOnly={showSavedOnly}
          onToggleSaved={() => {
            setShowSavedOnly((current) => !current);
            setHoveredStopId(null);
            setDetailStopId(null);
          }}
          onPreviewEnd={() => setHoveredStopId(null)}
          onSelect={selectStop}
          onCloseDetail={closeStopDetail}
          onToast={onToast}
        />
      </section>
    </main>
  );
}

function DashboardPage({
  query,
  onSearchQueryChange,
  onSearchSubmit,
  onNavigate,
  onStartJourney,
  onToast,
  confirmedSchedule,
  places,
  tripSession,
  sourceImport,
}) {
  const itineraryPlaces = useMemo(() => confirmedSchedule
    .map((schedule, index) => {
      const place = places.find((item) => item.id === schedule.stopId);
      if (!place) return null;
      const area = String(place.address ?? "").match(
        /(东城区|西城区|朝阳区|海淀区|丰台区|石景山区|怀柔区)/u,
      )?.[1] ?? "北京市";
      return {
        ...place,
        clientStopId: String(place.id),
        area,
        day: `第 1 天 · 第 ${index + 1} 站`,
        previewTime: schedule.time,
        summary: place.note,
      };
    })
    .filter(Boolean), [confirmedSchedule, places]);
  const [activeTab, setActiveTab] = useState("places");
  const [weatherExpanded, setWeatherExpanded] = useState(false);
  const [activePlaceId, setActivePlaceId] = useState(itineraryPlaces[0]?.id ?? null);

  const visiblePlaces = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return itineraryPlaces;
    return itineraryPlaces.filter((place) => (
      `${place.name}${place.area}${place.day}${place.summary}`.toLowerCase().includes(normalizedQuery)
    ));
  }, [itineraryPlaces, query]);

  const activePlace = itineraryPlaces.find((place) => place.id === activePlaceId)
    ?? itineraryPlaces[0]
    ?? null;

  useEffect(() => {
    if (itineraryPlaces.length > 0 && !itineraryPlaces.some((place) => place.id === activePlaceId)) {
      setActivePlaceId(itineraryPlaces[0].id);
    }
  }, [activePlaceId, itineraryPlaces]);

  return (
    <main className="page dashboard-page">
      <form
        className="dashboard-page-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit();
        }}
      >
        <label>
          <MagnifyingGlassIcon />
          <input
            value={query}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="搜索行程中的地点、区域或笔记"
            aria-label="搜索当前行程"
          />
        </label>
        <button type="submit" aria-label="搜索当前行程">
          <MagnifyingGlassIcon />
        </button>
      </form>

      <section className="dashboard-layout" data-dashboard-layout>
        <article className="dashboard-trip-card" data-dashboard-panel="trip">
          <header className="dashboard-overview-heading">
            <div className="dashboard-trip-title">
              <h1>北京 · 1 天</h1>
              <p>
                {tripSession?.localOnly
                  ? "已生成本地演示行程"
                  : tripSession?.tripId
                    ? "已保存到行程后端"
                    : "等待确认保存"}
              </p>
            </div>
            <button
              type="button"
              className={`dashboard-weather-compact ${weatherExpanded ? "expanded" : ""}`}
              onClick={() => setWeatherExpanded((current) => !current)}
              aria-expanded={weatherExpanded}
            >
              <span>
                <small>北京 · 行程首日</small>
                <strong>24°</strong>
              </span>
              <SunIcon />
              {weatherExpanded ? <em>晴朗，昼夜温差较大</em> : null}
            </button>
          </header>

          <div className="dashboard-tabs" role="tablist" aria-label="旅行手账分类">
            {[
              ["places", "地点", BookmarkIcon],
              ["notes", "笔记", FileTextIcon],
              ["bookings", "预订", CalendarIcon],
            ].map(([id, label, Icon]) => (
              <button
                type="button"
                role="tab"
                key={id}
                aria-selected={activeTab === id}
                className={activeTab === id ? "active" : ""}
                onClick={() => setActiveTab(id)}
              >
                <Icon />
                {label}
              </button>
            ))}
          </div>

          <div className="dashboard-tab-panel" role="tabpanel">
            {activeTab === "places" ? (
              visiblePlaces.length > 0 ? (
                <div className="dashboard-place-grid">
                  {visiblePlaces.map((place) => (
                  <article
                    className={`dashboard-place-card ${activePlaceId === place.id ? "active" : ""}`}
                    key={place.id}
                    data-dashboard-place={place.id}
                    onMouseEnter={() => setActivePlaceId(place.id)}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActivePlaceId(place.id);
                        onToast(`已在地图中定位「${place.name}」`);
                      }}
                    >
                      <img src={place.image} alt={place.name} />
                      <span className="dashboard-place-copy">
                        <span>
                          <strong>{place.name}</strong>
                          <small>{place.area}</small>
                        </span>
                        <em>{place.day}</em>
                      </span>
                    </button>
                  </article>
                  ))}
                </div>
              ) : (
                <div className="dashboard-empty-state">
                  <MagnifyingGlassIcon />
                  <strong>没有找到匹配的行程地点</strong>
                  <span>换一个地点、区域或行程关键词试试。</span>
                </div>
              )
            ) : null}

            {activeTab === "notes" ? (
              <div className="dashboard-note-list">
                {(sourceImport ? [{
                  title: sourceImport.extraction.title,
                  body: sourceImport.extraction.summary,
                  meta: "小红书公开分享 · 用户主动交接",
                }] : dashboardNotes).map((note) => (
                  <button type="button" key={note.title} onClick={() => onToast(`已打开笔记「${note.title}」`)}>
                    <span>{note.meta}</span>
                    <strong>{note.title}</strong>
                    <p>{note.body}</p>
                  </button>
                ))}
              </div>
            ) : null}

            {activeTab === "bookings" ? (
              <MeituanBookingPanel
                tripId={tripSession?.localOnly ? null : tripSession?.tripId ?? null}
                places={itineraryPlaces}
                activeStopId={activePlaceId}
                onSelectStop={setActivePlaceId}
              />
            ) : null}
          </div>

          <div className="dashboard-metrics" aria-label="行程摘要">
            <button type="button" onClick={() => onToast("当前路线覆盖北京东城与西城")}>
              <DashboardIcon />
              <span><strong>{new Set(itineraryPlaces.map((place) => place.area)).size}</strong><small>个区域</small></span>
            </button>
            <button type="button" onClick={() => onToast("当前为北京一日路线")}>
              <CalendarIcon />
              <span><strong>1</strong><small>天行程</small></span>
            </button>
            <button type="button" onClick={() => setActiveTab("places")}>
              <BookmarkIcon />
              <span><strong>{8 + itineraryPlaces.length}</strong><small>个收藏</small></span>
            </button>
            <button type="button" onClick={() => setActiveTab("places")}>
              <DrawingPinIcon />
              <span><strong>{itineraryPlaces.length}</strong><small>个地点</small></span>
            </button>
          </div>
        </article>

        <aside className="dashboard-notebook" data-dashboard-panel="notebook">
          <section className="dashboard-budget">
            <div className="dashboard-budget-summary">
              <span>预计预算</span>
              <strong>约 ¥320</strong>
              <small>北京一日演示估算 · 动态价格待核验</small>
            </div>
            <div className="dashboard-budget-breakdown">
              {[
                ["餐饮", "¥116", 36, "#5d674f"],
                ["交通", "¥45", 14, "#b9a63a"],
                ["门票", "¥107", 34, "#9b852f"],
                ["其他", "¥52", 16, "#a9aaa4"],
              ].map(([label, amount, value, color]) => (
                <div className="budget-row" key={label}>
                  <span>{label}</span>
                  <progress value={value} max="100" style={{ "--progress-color": color }} aria-label={`${label}${amount}`} />
                  <strong>{amount}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-map-card" aria-label="北京行程地图">
            <div className="dashboard-route-map">
              <RouteMap
                places={itineraryPlaces}
                orderedStopIds={confirmedSchedule.map((item) => item.stopId)}
                activeStopId={activePlaceId}
                onSelect={setActivePlaceId}
                compact
              />
            </div>
          </section>

          <section className="dashboard-journey-preview">
            <header>
              <div>
                <span>行程已就绪</span>
                <h2>旅程预览</h2>
              </div>
              <button type="button" onClick={() => onToast("分享链接已准备好")} aria-label="分享行程">
                <Share1Icon />
              </button>
            </header>
            <ol>
              {itineraryPlaces.map((place) => (
                <li key={place.id} className={activePlaceId === place.id ? "active" : ""}>
                  <button
                    type="button"
                    onMouseEnter={() => setActivePlaceId(place.id)}
                    onClick={() => setActivePlaceId(place.id)}
                  >
                    <DrawingPinIcon />
                    <time>{place.previewTime}</time>
                    <span>
                      <strong>{place.name}</strong>
                      <small>{place.summary}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <footer>
              <button type="button" className="dashboard-view-plan" onClick={() => onNavigate("canvas")}>
                查看完整行程
                <ArrowRightIcon />
              </button>
              <button
                type="button"
                className="dashboard-start-journey"
                data-dashboard-start-journey
                onClick={onStartJourney}
              >
                <PaperPlaneIcon />
                开始行程
              </button>
            </footer>
          </section>
        </aside>
      </section>
    </main>
  );
}

function DiscoverPage({ query, onStartPlanning, onImported, onToast }) {
  const [saved, setSaved] = useState(["beijing-hutong-art"]);

  const visibleRoutes = routes.filter((route) => {
    const searchable = `${route.title}${route.city}${route.creator}${route.tag}${route.highlights.join("")}`.toLowerCase();
    return searchable.includes(query.trim().toLowerCase());
  });

  const toggleSaved = (id) => {
    setSaved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    onToast(saved.includes(id) ? "已取消收藏" : "已收藏，并保留创作者来源");
  };

  return (
    <main className="page discover-page">
      <XiaohongshuImportShelf onImported={onImported} />
      <section className="route-grid" aria-label="路线发现结果">
        {visibleRoutes.map((route) => (
          <article
            className={`route-card ${route.featured ? "featured" : ""} ${route.wide ? "wide" : ""}`}
            key={route.id}
          >
            <img className="route-card-image" src={route.image} alt={`${route.title}实景`} />
            <span className="route-card-overlay" />
            <div className="route-card-heading">
              <span>{route.city} · {route.days}</span>
              <h2>{route.title}</h2>
              <em><ReaderIcon /> {route.tag}</em>
            </div>
            <div className="route-card-stops" aria-label="路线部分站点">
              {route.highlights.slice(0, route.featured ? 4 : 3).map((stopName) => (
                <span key={stopName}><DrawingPinIcon />{stopName}</span>
              ))}
            </div>
            <div className="route-card-footer">
              <span className="creator">
                <img
                  src={route.avatar}
                  alt={`${route.creator}头像`}
                  onError={(event) => { event.currentTarget.src = "/assets/creator-chen.png"; }}
                />
                <span>
                  <strong>{route.creator}</strong>
                  <small>{route.followers}</small>
                </span>
              </span>
              <span className="route-budget">{route.budget}</span>
              <button type="button" className="card-plan-button" onClick={() => onStartPlanning(route)}>
                查看路线
                <ArrowRightIcon />
              </button>
            </div>
            <button
              type="button"
              className={`save-route ${saved.includes(route.id) ? "saved" : ""}`}
              onClick={() => toggleSaved(route.id)}
              aria-label={`${saved.includes(route.id) ? "取消收藏" : "收藏"}${route.title}`}
            >
              <BookmarkIcon />
            </button>
          </article>
        ))}
        {visibleRoutes.length === 0 ? (
          <div className="empty-route-state">
            <MagnifyingGlassIcon />
            <strong>还没有匹配的路线</strong>
            <span>换一个城市、主题或创作者名字试试。</span>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function PlannerCanvasPage({ lanes, setLanes, onConfirm, onToast }) {
  const [draggedId, setDraggedId] = useState(null);
  const laneMeta = [
    { id: "morning", title: "上午", time: "09:00–12:00", tone: "morning" },
    { id: "afternoon", title: "下午", time: "12:15–16:00", tone: "afternoon" },
    { id: "evening", title: "傍晚", time: "16:40–20:10", tone: "evening" },
  ];
  const currentStopOrder = laneMeta.flatMap((lane) => lanes[lane.id]);

  const moveStop = (stopId, targetLaneId, targetIndex = null) => {
    const next = Object.fromEntries(Object.entries(lanes).map(([laneId, ids]) => [laneId, ids.filter((id) => id !== stopId)]));
    const insertAt = targetIndex === null ? next[targetLaneId].length : targetIndex;
    next[targetLaneId].splice(insertAt, 0, stopId);
    setLanes(next);
  };

  const onCardDrop = (event, laneId, targetIndex) => {
    event.preventDefault();
    event.stopPropagation();
    const stopId = Number(event.dataTransfer.getData("text/plain") || draggedId);
    if (stopId) moveStop(stopId, laneId, targetIndex);
    setDraggedId(null);
  };

  const moveStopByKeyboard = (event, stopId, laneId, index) => {
    const laneIndex = laneMeta.findIndex((lane) => lane.id === laneId);
    if (event.key === "ArrowLeft" && laneIndex > 0) {
      event.preventDefault();
      moveStop(stopId, laneMeta[laneIndex - 1].id);
      onToast("已移到上一个时段");
    }
    if (event.key === "ArrowRight" && laneIndex < laneMeta.length - 1) {
      event.preventDefault();
      moveStop(stopId, laneMeta[laneIndex + 1].id);
      onToast("已移到下一个时段");
    }
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      moveStop(stopId, laneId, index - 1);
      onToast("已向前调整一位");
    }
    if (event.key === "ArrowDown" && index < lanes[laneId].length - 1) {
      event.preventDefault();
      moveStop(stopId, laneId, index + 1);
      onToast("已向后调整一位");
    }
  };

  return (
    <main className="page canvas-page">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">第二步 · 排成我的路线</p>
          <h1>旅行规划画布</h1>
          <p>拖动地点卡片，调整它属于哪个时段以及先后顺序。</p>
        </div>
        <div className="page-title-actions">
          <button type="button" className="ghost-button" onClick={() => { setLanes(initialLanes); onToast("已恢复创作者原始顺序"); }}>
            <ReloadIcon />
            恢复原路线
          </button>
          <button type="button" className="primary-button" onClick={onConfirm}>
            确认排版
            <ArrowRightIcon />
          </button>
        </div>
      </section>

      <section className="planner-layout">
        <aside className="source-panel">
          <div className="source-cover">
            <img src="/assets/beijing-hero-hutong.png" alt="北京胡同与艺文一日" />
            <span />
            <div>
              <small>当前灵感来源</small>
              <h2>北京胡同与艺文一日</h2>
              <p>陈以欢 · 真实走过</p>
            </div>
          </div>
          <div className="source-proof">
            <CheckCircledIcon />
            <span>
              <strong>来源会一直保留</strong>
              <small>你的调整不会覆盖原路线。</small>
            </span>
          </div>
          <section className="constraint-section">
            <div className="panel-heading">
              <div>
                <span>我的约束</span>
                <strong>真正会改变路线的条件</strong>
              </div>
              <button type="button" onClick={() => onToast("约束编辑面板将在完整版本接入")}><Pencil1Icon /></button>
            </div>
            <div className="constraint-list">
              <span><CalendarIcon />7 月 25 日 · 1 天</span>
              <span><PersonIcon />两人同行 · 慢节奏</span>
              <span><DrawingPinIcon />住东直门附近</span>
              <span><ClockIcon />14:30 展览已预约</span>
            </div>
          </section>
          <button type="button" className="ai-check-button" onClick={() => onToast("检查通过：预约未冲突，已保留两段缓冲")}>
            <MagicWandIcon />
            <span>
              <strong>检查当前安排</strong>
              <small>交通、营业时间与体力节奏</small>
            </span>
            <ChevronRightIcon />
          </button>
        </aside>

        <section className="canvas-workspace">
          <div className="canvas-toolbar">
            <div>
              <strong>Day 1 · 北京</strong>
              <span>6 个地点 · 预计 10 小时 · 步行 4.6 公里</span>
            </div>
            <div>
              <button type="button" onClick={() => onToast("已缩小画布")}><MinusIcon /></button>
              <span>100%</span>
              <button type="button" onClick={() => onToast("已放大画布")}><PlusIcon /></button>
            </div>
          </div>
          <div className="canvas-lanes">
            {laneMeta.map((lane) => (
              <section
                key={lane.id}
                className={`canvas-lane ${lane.tone}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const stopId = Number(event.dataTransfer.getData("text/plain") || draggedId);
                  if (stopId) moveStop(stopId, lane.id);
                  setDraggedId(null);
                }}
              >
                <header>
                  <span><i />{lane.title}</span>
                  <small>{lane.time}</small>
                </header>
                <div className="lane-cards">
                  {lanes[lane.id].map((stopId, index) => {
                    const stop = stops.find((item) => item.id === stopId);
                    return (
                      <article
                        className={`canvas-stop-card ${draggedId === stop.id ? "dragging" : ""}`}
                        key={stop.id}
                        draggable
                        tabIndex={0}
                        aria-label={`${stop.name}，${lane.title}第 ${index + 1} 位。可拖动，或用方向键调整时段与顺序。`}
                        onDragStart={(event) => {
                          setDraggedId(stop.id);
                          event.dataTransfer.setData("text/plain", String(stop.id));
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setDraggedId(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => onCardDrop(event, lane.id, index)}
                        onKeyDown={(event) => moveStopByKeyboard(event, stop.id, lane.id, index)}
                      >
                        <img src={stop.image} alt={`${stop.name}实景`} />
                        <div className="canvas-card-copy">
                          <span>{itineraryTimes[currentStopOrder.indexOf(stop.id)]} · {stop.duration}</span>
                          <h3>{stop.name}</h3>
                          <p>{stop.type}</p>
                        </div>
                        <button type="button" aria-label={`调整${stop.name}`} onClick={() => onToast("拖动卡片即可调整顺序")}>
                          <MixerHorizontalIcon />
                        </button>
                      </article>
                    );
                  })}
                  <button type="button" className="add-stop-card" onClick={() => onToast(`${lane.title}地点库将在完整版本接入`)}>
                    <PlusIcon />
                    添加一个地点
                  </button>
                </div>
              </section>
            ))}
          </div>
          <div className="canvas-status">
            <span><CheckCircledIcon />当前安排可执行</span>
            <p>画廊预约已锁定 · 两段交通留有 20 分钟缓冲 · 预计比原路线少走 45 分钟</p>
          </div>
        </section>
      </section>
    </main>
  );
}

function TimelinePlannerPage({
  timelineSlots,
  setTimelineSlots,
  places = defaultTravelPlaces,
  tripSession = null,
  plannerState = null,
  onConfirm,
  onEnsureAgentDraft,
  onAgentTripCommitted,
  onPersistManualPlan,
  onToast,
  isConfirming = false,
  sourceImport = null,
  isVisible = true,
}) {
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragGuide, setDragGuide] = useState(null);
  const [activeStopId, setActiveStopId] = useState(1);
  const [libraryDetailStopId, setLibraryDetailStopId] = useState(null);
  const [libraryDetailPosition, setLibraryDetailPosition] = useState({
    top: 112,
    left: 360,
    maxHeight: 720,
  });
  const [isTrashArmed, setIsTrashArmed] = useState(false);
  const [isCanvasPanning, setIsCanvasPanning] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(TIMELINE_ZOOM_DEFAULT);
  const [timelineZoomMode, setTimelineZoomMode] = useState("manual");
  const [constraints, setConstraints] = useState(
    () => plannerState?.constraints?.map((constraint) => ({ ...constraint })) ?? [],
  );
  const [transportModeOverrides, setTransportModeOverrides] = useState(
    () => ({ ...(plannerState?.transportModeOverrides ?? {}) }),
  );
  const [agentInput, setAgentInput] = useState("");
  const [demoAgentState, setDemoAgentState] = useState(createPlannerAgentDemoState);
  const [undoStack, setUndoStack] = useState([]);
  const timelineStageRef = useRef(null);
  const dragPreviewRef = useRef(null);
  const dragFrameRef = useRef(null);
  const pendingZoomAnchorRef = useRef(null);
  const pendingWheelZoomRef = useRef(null);
  const wheelZoomFrameRef = useRef(null);
  const pendingDragGuideRef = useRef(null);
  const hasInitialTimelineScrollRef = useRef(false);
  const libraryDetailRef = useRef(null);
  const libraryDragIntentRef = useRef(false);
  const agentTranscriptRef = useRef(null);
  const demoStepTimerRef = useRef(null);
  const manualChangedStopIdsRef = useRef(new Set());
  const manualAuthorityPromiseRef = useRef(null);
  const canvasPanRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const interactionLockRef = useRef(false);
  const timelineZoomModeRef = useRef(timelineZoomMode);
  const timelineMetrics = useMemo(() => getTimelineMetrics(timelineZoom), [timelineZoom]);
  const timelineMetricsRef = useRef(timelineMetrics);
  timelineMetricsRef.current = timelineMetrics;
  interactionLockRef.current = Boolean(draggedItem) || isCanvasPanning || canvasPanRef.current.active;
  timelineZoomModeRef.current = timelineZoomMode;
  const agent = usePlannerAgentRun({
    tripSession,
    onTripCommitted: onAgentTripCommitted,
    onToast,
  });
  const demoAgentVisible = demoAgentState.phase !== "idle";
  const demoAgentIsActive = ["running", "paused"].includes(demoAgentState.phase);
  const demoAgentOperations = buildPlannerAgentDemoOperations(demoAgentState);
  const agentStatus = demoAgentVisible ? demoAgentState.phase : agent.state.phase;
  const agentMessages = demoAgentVisible ? demoAgentState.messages : agent.state.messages;
  const agentPreview = demoAgentVisible
    ? demoAgentState.previewOperation
    : agent.previewOperation;
  const agentChangedStopIds = demoAgentVisible
    ? demoAgentState.changedStopIds
    : agent.changedStopIds;
  const agentOperations = demoAgentVisible ? demoAgentOperations : agent.operations;
  const agentError = demoAgentVisible ? demoAgentState.error : agent.state.error;
  const agentConnection = demoAgentVisible ? "connected" : agent.state.connection;
  useEffect(() => {
    setConstraints(plannerState?.constraints?.map((constraint) => ({ ...constraint })) ?? []);
    setTransportModeOverrides({ ...(plannerState?.transportModeOverrides ?? {}) });
  }, [plannerState]);
  const sortedTimelineSlots = useMemo(() => sortTimelineSlots(timelineSlots), [timelineSlots]);
  const demoResultRows = useMemo(() => {
    if (demoAgentState.phase !== "completed" || !demoAgentState.snapshot) return [];
    const previousTimes = new Map(
      demoAgentState.snapshot.timelineSlots.map((slot) => [Number(slot.stopId), slot.time]),
    );
    return demoAgentState.changedStopIds
      .map((stopId) => {
        const numericStopId = Number(stopId);
        const stop = places.find((item) => Number(item.id) === numericStopId);
        const currentSlot = sortedTimelineSlots.find(
          (slot) => Number(slot.stopId) === numericStopId,
        );
        const previousTime = previousTimes.get(numericStopId);
        if (!stop || !currentSlot || !previousTime || previousTime === currentSlot.time) return null;
        return {
          stopId: numericStopId,
          name: stop.name,
          previousTime,
          currentTime: currentSlot.time,
        };
      })
      .filter(Boolean);
  }, [
    demoAgentState.phase,
    demoAgentState.snapshot,
    demoAgentState.changedStopIds,
    places,
    sortedTimelineSlots,
  ]);
  const demoUnchangedStopCount = demoAgentState.snapshot
    ? Math.max(0, demoAgentState.snapshot.timelineSlots.length - demoResultRows.length)
    : 0;
  const orderedStopIds = sortedTimelineSlots.map((slot) => slot.stopId);
  const plannerMapPlaces = useMemo(() => places.map((stop) => {
    const slot = sortedTimelineSlots.find((item) => Number(item.stopId) === Number(stop.id));
    return slot ? { ...stop, time: slot.time } : stop;
  }), [places, sortedTimelineSlots]);
  const earliestMinutes = sortedTimelineSlots.length ? timeToMinutes(sortedTimelineSlots[0].time) : null;
  const axisTicks = useMemo(() => Array.from({ length: 13 }, (_, index) => {
    const minutes = index * 120;
    return { minutes, label: formatTimelineMinute(minutes) };
  }), []);
  const timelineLayout = useMemo(() => {
    const trackEndMinutes = [];
    const items = sortedTimelineSlots.map((slot) => {
      const minutes = timeToMinutes(slot.time);
      const stop = places.find((item) => item.id === slot.stopId);
      const durationMinutes = getStopDurationMinutes(stop);
      const endMinutes = Math.min(TIMELINE_DAY_MINUTES, minutes + durationMinutes);
      const durationWidth = Math.max(
        1,
        (endMinutes - minutes) * timelineMetrics.pxPerMinute,
      );
      const cardWidth = timelineMetrics.cardWidth;
      let track = trackEndMinutes.findIndex((trackEndMinute) => (
        minutes >= trackEndMinute
      ));
      if (track < 0) track = trackEndMinutes.length;
      trackEndMinutes[track] = endMinutes;
      const startX = timelineMinuteToX(minutes, timelineMetrics);
      return {
        ...slot,
        minutes,
        durationMinutes,
        durationWidth,
        cardWidth,
        endMinutes,
        endTime: formatTimelineMinute(endMinutes),
        track,
        startX,
        x: startX + durationWidth / 2,
        top: timelineMetrics.cardTop + track * (timelineMetrics.cardHeight + timelineMetrics.trackGap),
      };
    });
    return {
      items,
      trackCount: Math.max(1, trackEndMinutes.length),
    };
  }, [places, sortedTimelineSlots, timelineMetrics]);
  const latestEndMinutes = timelineLayout.items.length
    ? Math.max(...timelineLayout.items.map((slot) => slot.endMinutes))
    : null;
  const timelineTransportLegs = useMemo(() => timelineLayout.items.slice(0, -1).map((slot, index) => {
    const nextSlot = timelineLayout.items[index + 1];
    const stop = places.find((item) => item.id === slot.stopId);
    const nextStop = places.find((item) => item.id === nextSlot.stopId);
    const legId = `${slot.slotId}>${nextSlot.slotId}`;
    const profile = getTimelineTransportProfile(
      stop?.id,
      nextStop?.id,
      transportModeOverrides[legId],
    );
    const estimatedTravelMinutes = profile.minutes;
    const plannedGapMinutes = Math.max(0, nextSlot.minutes - slot.endMinutes);
    const bufferMinutes = Math.max(0, plannedGapMinutes - estimatedTravelMinutes);
    const conflict = plannedGapMinutes < estimatedTravelMinutes;
    const conflictMinutes = Math.max(
      0,
      slot.endMinutes + estimatedTravelMinutes - nextSlot.minutes,
    );
    const fromCardBottomY = slot.top + timelineMetrics.cardHeight;
    const toCardBottomY = nextSlot.top + timelineMetrics.cardHeight;
    const fromRailY = fromCardBottomY + timelineMetrics.routeLaneOffset;
    const toRailY = toCardBottomY + timelineMetrics.routeLaneOffset;
    const routeClearance = 22;
    const cardsShareTrack = fromRailY === toRailY;
    const routeDirection = nextSlot.x >= slot.x ? 1 : -1;
    const bendX = cardsShareTrack
      ? (slot.x + nextSlot.x) / 2
      : routeDirection > 0
        ? Math.max(
          slot.x + slot.cardWidth / 2,
          nextSlot.x + nextSlot.cardWidth / 2,
        ) + routeClearance
        : Math.min(
          slot.x - slot.cardWidth / 2,
          nextSlot.x - nextSlot.cardWidth / 2,
        ) - routeClearance;
    const connectorLeft = Math.min(slot.x, nextSlot.x, bendX);
    const connectorRight = Math.max(slot.x, nextSlot.x, bendX);
    const connectorTop = Math.min(fromRailY, toRailY);
    const connectorBottom = Math.max(fromRailY, toRailY);

    return {
      id: legId,
      fromSlotId: slot.slotId,
      toSlotId: nextSlot.slotId,
      fromStopName: stop?.name ?? "",
      toStopName: nextStop?.name ?? "",
      mode: profile.mode,
      label: profile.label,
      availableModes: profile.availableModes,
      distance: profile.distance,
      estimatedCost: profile.estimatedCost,
      travelMinutes: estimatedTravelMinutes,
      estimatedTravelMinutes,
      plannedGapMinutes,
      bufferMinutes,
      conflictMinutes,
      fromEndMinutes: slot.endMinutes,
      toStartMinutes: nextSlot.minutes,
      conflict,
      x: (slot.x + nextSlot.x) / 2,
      top: fromRailY - timelineMetrics.transportIconSize / 2,
      connectorLeft,
      connectorTop,
      connectorWidth: connectorRight - connectorLeft,
      connectorHeight: connectorBottom - connectorTop,
      fromConnectorX: slot.x - connectorLeft,
      toConnectorX: nextSlot.x - connectorLeft,
      bendConnectorX: bendX - connectorLeft,
      fromCardBottomY,
      toCardBottomY,
      fromRailY,
      toRailY,
    };
  }), [places, timelineLayout, timelineMetrics, transportModeOverrides]);
  const timelineEstimatedAmount = useMemo(() => {
    const placeRange = timelineLayout.items.reduce((total, slot) => {
      const stop = places.find((item) => item.id === slot.stopId);
      const range = getEstimatedCostRange(stop?.cost);
      return {
        min: total.min + range.min,
        max: total.max + range.max,
      };
    }, { min: 0, max: 0 });
    const transportRange = timelineTransportLegs.reduce((total, leg) => {
      const range = getEstimatedCostRange(leg.estimatedCost);
      return {
        min: total.min + range.min,
        max: total.max + range.max,
      };
    }, { min: 0, max: 0 });
    const min = placeRange.min + transportRange.min;
    const max = placeRange.max + transportRange.max;
    return min === max
      ? `¥${formatEstimatedAmount(min)}`
      : `¥${formatEstimatedAmount(min)}–${formatEstimatedAmount(max)}`;
  }, [places, timelineLayout.items, timelineTransportLegs]);
  const hasTimelineConflict = timelineTransportLegs.some((leg) => leg.conflict);
  const timelineSurfaceHeight = Math.max(
    500,
    timelineMetrics.cardTop
      + timelineLayout.trackCount * (timelineMetrics.cardHeight + timelineMetrics.trackGap)
      + 230,
  );
  const activeSlot = sortedTimelineSlots.find((slot) => slot.stopId === activeStopId)
    ?? sortedTimelineSlots[0];
  const activeStop = activeSlot ? places.find((stop) => stop.id === activeSlot.stopId) : null;
  const dragGuideStop = dragGuide ? places.find((stop) => stop.id === dragGuide.stopId) : null;
  const libraryDetailStop = libraryDetailStopId
    ? places.find((stop) => stop.id === libraryDetailStopId)
    : null;
  const libraryDetailSlot = libraryDetailStopId
    ? sortedTimelineSlots.find((slot) => slot.stopId === libraryDetailStopId)
    : null;
  const hasMorningConstraint = constraints.some((constraint) => constraint.id === "saturday-morning");
  const agentIsActive = demoAgentIsActive || agent.isActive;
  const agentIsWorking = ["starting", "planning", "running", "resuming"].includes(agentStatus);
  const agentStatusLabel = {
    idle: "等待你的安排",
    starting: "正在建立任务",
    planning: "正在理解约束",
    running: "正在协作调整",
    pausing: "正在安全暂停",
    paused: "已暂停，等你决定",
    resuming: "正在从当前版本继续",
    stopping: "正在停止",
    stopped: "已停止，保留当前版本",
    completed: "本轮调整完成",
    failed: "本轮执行失败",
    conflicted: "检测到版本冲突",
    reconnecting: "正在恢复连接",
    undoing: "正在撤回本轮",
  }[agentStatus] ?? "正在同步";
  const agentCanPause = demoAgentVisible
    ? demoAgentState.phase === "running" && !demoAgentState.isPersisting
    : agent.canPause;
  const agentCanResume = demoAgentVisible
    ? demoAgentState.phase === "paused" && !demoAgentState.isPersisting
    : agent.canResume;
  const agentCanStop = demoAgentVisible
    ? demoAgentIsActive && !demoAgentState.isPersisting
    : agent.canStop;
  const agentCanUndo = demoAgentVisible
    ? Boolean(demoAgentState.snapshot) && !demoAgentState.isPersisting
    : agent.canUndo;
  const agentControlsVisible = demoAgentVisible
    || Boolean(agent.state.runId)
    || ["failed", "conflicted", "stopped", "completed"].includes(agentStatus);

  const transitionUpdate = (update) => {
    if (typeof document !== "undefined" && document.startViewTransition) {
      return document.startViewTransition(() => flushSync(update));
    }
    update();
    return null;
  };

  const snapshotCurrentPlan = (label) => ({
    label,
    timelineSlots: timelineSlots.map((slot) => ({ ...slot })),
    constraints: constraints.map((constraint) => ({ ...constraint })),
    transportModeOverrides: { ...transportModeOverrides },
    activeStopId,
  });

  const pushUndoSnapshot = (label) => {
    const snapshot = snapshotCurrentPlan(label);
    setUndoStack((current) => [...current.slice(-9), snapshot]);
    return snapshot;
  };

  const restoreSnapshot = (snapshot) => {
    if (!snapshot) return;
    transitionUpdate(() => {
      setTimelineSlots(sortTimelineSlots(snapshot.timelineSlots.map((slot) => ({ ...slot }))));
      setConstraints(snapshot.constraints.map((constraint) => ({ ...constraint })));
      setTransportModeOverrides({ ...(snapshot.transportModeOverrides ?? {}) });
      setActiveStopId(snapshot.activeStopId ?? snapshot.timelineSlots[0]?.stopId ?? null);
    });
    manualChangedStopIdsRef.current = new Set();
  };

  const clearDemoStepTimer = () => {
    if (demoStepTimerRef.current === null) return;
    window.clearTimeout(demoStepTimerRef.current);
    demoStepTimerRef.current = null;
  };

  const resetDemoAgent = () => {
    clearDemoStepTimer();
    setDemoAgentState(createPlannerAgentDemoState());
  };

  const persistDemoPlan = async (
    nextTimelineSlots = timelineSlots,
    nextConstraints = constraints,
    nextTransportModeOverrides = transportModeOverrides,
  ) => {
    if (typeof onPersistManualPlan !== "function") return true;
    setDemoAgentState((current) => (
      current.phase === "idle"
        ? current
        : { ...current, isPersisting: true, error: null }
    ));
    try {
      await onPersistManualPlan(nextTimelineSlots, {
        constraints: nextConstraints,
        transportModeOverrides: nextTransportModeOverrides,
      });
      setDemoAgentState((current) => (
        current.phase === "idle"
          ? current
          : { ...current, isPersisting: false }
      ));
      return true;
    } catch (error) {
      setDemoAgentState((current) => (
        current.phase === "idle"
          ? current
          : {
            ...current,
            isPersisting: false,
            error: null,
          }
      ));
      onToast("演示结果已保留在当前画布，可继续确认行程");
      return false;
    }
  };

  const pauseForManualTakeover = async () => {
    if (demoAgentState.isPersisting) {
      onToast("正在保存刚才的人工修改，请稍候");
      return false;
    }
    if (demoAgentState.phase === "running") {
      clearDemoStepTimer();
      setDemoAgentState((current) => ({
        ...current,
        phase: "paused",
        previewOperation: null,
        messages: [
          ...current.messages,
          {
            role: "assistant",
            text: "我已暂停。你正在接管画布；我会保留你的手动修改，并从这个最新版本继续。",
          },
        ],
      }));
      onToast("Agent 已暂停，你现在拥有编辑权");
      return true;
    }
    if (demoAgentState.phase === "paused") return true;
    if (!agentIsActive) return true;
    if (!manualAuthorityPromiseRef.current) {
      manualAuthorityPromiseRef.current = agent.requestManualTakeover()
        .then(() => {
          onToast("Agent 已暂停，你现在拥有编辑权");
          return true;
        })
        .catch((error) => {
          onToast(error?.message ?? "Agent 暂停失败，请稍后再试");
          return false;
        })
        .finally(() => {
          manualAuthorityPromiseRef.current = null;
        });
    }
    return manualAuthorityPromiseRef.current;
  };

  const cycleTimelineTransportMode = async (leg) => {
    if (!(await pauseForManualTakeover())) return;
    const currentIndex = Math.max(0, leg.availableModes.indexOf(leg.mode));
    const nextMode = leg.availableModes[(currentIndex + 1) % leg.availableModes.length];
    const nextProfile = getTimelineTransportProfile(
      timelineLayout.items.find((slot) => slot.slotId === leg.fromSlotId)?.stopId,
      timelineLayout.items.find((slot) => slot.slotId === leg.toSlotId)?.stopId,
      nextMode,
    );
    pushUndoSnapshot("切换交通方式");
    const nextTransportModeOverrides = {
      ...transportModeOverrides,
      [leg.id]: nextMode,
    };
    setTransportModeOverrides(nextTransportModeOverrides);
    if (
      typeof onPersistManualPlan === "function"
      && (tripSession?.tripId || demoAgentVisible)
    ) {
      try {
        if (demoAgentVisible) {
          const saved = await persistDemoPlan(
            timelineSlots,
            constraints,
            nextTransportModeOverrides,
          );
          if (!saved) return;
        } else {
          await onPersistManualPlan(timelineSlots, {
            constraints,
            transportModeOverrides: nextTransportModeOverrides,
          });
        }
      } catch (error) {
        onToast(error?.message ?? "交通方式已显示，但后端版本保存失败");
        return;
      }
    }
    onToast(
      `${leg.fromStopName}到${leg.toStopName}已切换为${nextProfile.label}，预计 ${nextProfile.minutes} 分钟，${nextProfile.estimatedCost}`,
    );
  };

  const scrollTimelineNearMinute = (minutes, behavior = "auto") => {
    window.requestAnimationFrame(() => {
      const stage = timelineStageRef.current;
      if (!stage) return;
      const targetX = timelineMinuteToX(minutes, timelineMetricsRef.current);
      stage.scrollTo({
        left: Math.max(0, targetX - Math.min(stage.clientWidth * 0.14, 96)),
        behavior,
      });
    });
  };

  const applyTimelineZoom = (
    requestedZoom,
    { mode = "manual", focusMinute = null, anchorClientX = null } = {},
  ) => {
    if (interactionLockRef.current) return;
    const stage = timelineStageRef.current;
    const currentMetrics = timelineMetricsRef.current;
    const nextMetrics = getTimelineMetrics(requestedZoom);
    if (
      Math.abs(nextMetrics.zoom - currentMetrics.zoom) < 0.001
      && mode === timelineZoomModeRef.current
    ) return;

    const stageBounds = stage?.getBoundingClientRect();
    const anchorOffset = stage
      ? Math.max(
        0,
        Math.min(
          anchorClientX === null
            ? stage.clientWidth / 2
            : anchorClientX - stageBounds.left - stage.clientLeft,
          stage.clientWidth,
        ),
      )
      : 0;
    const centeredMinute = stage
      ? (stage.scrollLeft + anchorOffset - currentMetrics.edgeGutter)
        / currentMetrics.pxPerMinute
      : earliestMinutes ?? 9 * 60;
    const anchorMinute = Math.max(
      0,
      Math.min(focusMinute ?? centeredMinute, TIMELINE_DAY_MINUTES),
    );
    const previousScrollTop = stage?.scrollTop ?? 0;

    pendingZoomAnchorRef.current = {
      anchorMinute,
      anchorOffset,
      previousScrollTop,
      metrics: nextMetrics,
    };
    timelineMetricsRef.current = nextMetrics;
    timelineZoomModeRef.current = mode;
    setTimelineZoom(nextMetrics.zoom);
    setTimelineZoomMode(mode);
  };

  useLayoutEffect(() => {
    const pending = pendingZoomAnchorRef.current;
    const stage = timelineStageRef.current;
    if (!pending || !stage) return;
    const nextLeft = timelineMinuteToX(pending.anchorMinute, pending.metrics)
      - pending.anchorOffset;
    stage.scrollTo({
      left: Math.max(0, Math.min(nextLeft, stage.scrollWidth - stage.clientWidth)),
      top: Math.max(0, Math.min(pending.previousScrollTop, stage.scrollHeight - stage.clientHeight)),
      behavior: "auto",
    });
    pendingZoomAnchorRef.current = null;
  }, [timelineZoom, timelineZoomMode]);

  const stepTimelineZoom = (direction) => {
    const currentZoom = timelineMetricsRef.current.zoom;
    const nextZoom = direction > 0
      ? TIMELINE_ZOOM_LEVELS.find((level) => level > currentZoom + 0.001)
      : [...TIMELINE_ZOOM_LEVELS]
        .reverse()
        .find((level) => level < currentZoom - 0.001);
    if (nextZoom === undefined) return;
    applyTimelineZoom(nextZoom);
  };

  const fitTimelineToView = () => {
    if (interactionLockRef.current) return;
    const stage = timelineStageRef.current;
    if (!stage) return;

    const startMinute = earliestMinutes ?? 0;
    const endMinute = latestEndMinutes ?? TIMELINE_DAY_MINUTES;
    const spanMinutes = Math.max(60, endMinute - startMinute);
    const availableWidth = Math.max(180, stage.clientWidth - 48);
    const basePxPerMinute = TIMELINE_HOUR_WIDTH / 60;
    let fitZoom = clampTimelineZoom(
      (availableWidth - TIMELINE_CARD_WIDTH) / (spanMinutes * basePxPerMinute),
    );

    for (let index = 0; index < 2; index += 1) {
      const fitMetrics = getTimelineMetrics(fitZoom);
      fitZoom = clampTimelineZoom(
        (availableWidth - fitMetrics.cardWidth) / (spanMinutes * basePxPerMinute),
      );
    }

    applyTimelineZoom(
      Math.min(TIMELINE_ZOOM_DEFAULT, fitZoom),
      {
        mode: "fit",
        focusMinute: (startMinute + endMinute) / 2,
      },
    );
  };

  const handleTimelineZoomShortcut = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      stepTimelineZoom(1);
    }
    if (event.key === "-") {
      event.preventDefault();
      stepTimelineZoom(-1);
    }
    if (event.key === "0") {
      event.preventDefault();
      applyTimelineZoom(TIMELINE_ZOOM_DEFAULT);
    }
  };

  useEffect(() => {
    if (hasInitialTimelineScrollRef.current || !timelineStageRef.current) return;
    hasInitialTimelineScrollRef.current = true;
    scrollTimelineNearMinute(earliestMinutes ?? 9 * 60);
  }, [earliestMinutes]);

  useEffect(() => {
    if (timelineZoomMode !== "fit" || typeof ResizeObserver === "undefined") return undefined;
    const stage = timelineStageRef.current;
    if (!stage) return undefined;
    let frame = null;
    const observer = new ResizeObserver(() => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (timelineZoomModeRef.current === "fit" && !interactionLockRef.current) {
          fitTimelineToView();
        }
      });
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [timelineZoomMode, earliestMinutes, latestEndMinutes]);

  useEffect(() => {
    const stage = timelineStageRef.current;
    if (!stage) return undefined;

    const handleTrackpadPinch = (event) => {
      if (!event.ctrlKey || !event.cancelable) return;
      event.preventDefault();
      if (!event.defaultPrevented || interactionLockRef.current || event.deltaY === 0) return;

      const deltaUnit = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? stage.clientHeight
          : 1;
      const eventDelta = Math.max(-80, Math.min(80, event.deltaY * deltaUnit));
      const pending = pendingWheelZoomRef.current ?? { delta: 0, clientX: event.clientX };
      pending.delta = Math.max(-120, Math.min(120, pending.delta + eventDelta));
      pending.clientX = event.clientX;
      pendingWheelZoomRef.current = pending;
      if (wheelZoomFrameRef.current) return;

      wheelZoomFrameRef.current = window.requestAnimationFrame(() => {
        wheelZoomFrameRef.current = null;
        const wheelInput = pendingWheelZoomRef.current;
        pendingWheelZoomRef.current = null;
        if (!wheelInput || interactionLockRef.current) return;
        const currentZoom = timelineMetricsRef.current.zoom;
        const nextZoom = Math.round(
          clampTimelineZoom(currentZoom * Math.exp(-wheelInput.delta * 0.0025)) * 1000,
        ) / 1000;
        if (Math.abs(nextZoom - currentZoom) < 0.001) return;
        applyTimelineZoom(nextZoom, {
          mode: "manual",
          anchorClientX: wheelInput.clientX,
        });
      });
    };

    stage.addEventListener("wheel", handleTrackpadPinch, { passive: false });
    return () => {
      stage.removeEventListener("wheel", handleTrackpadPinch);
      if (wheelZoomFrameRef.current) window.cancelAnimationFrame(wheelZoomFrameRef.current);
      wheelZoomFrameRef.current = null;
      pendingWheelZoomRef.current = null;
    };
  }, []);

  useEffect(() => () => {
    if (dragFrameRef.current) window.cancelAnimationFrame(dragFrameRef.current);
  }, []);

  useEffect(() => {
    if (!libraryDetailStopId) return undefined;

    const closeOnOutsidePointer = (event) => {
      if (libraryDetailRef.current?.contains(event.target)) return;
      if (event.target.closest?.(`[data-library-stop-id="${libraryDetailStopId}"]`)) return;
      setLibraryDetailStopId(null);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      const stopId = libraryDetailStopId;
      setLibraryDetailStopId(null);
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-library-stop-id="${stopId}"]`)?.focus({
          preventScroll: true,
        });
      });
    };
    const closeOnResize = () => setLibraryDetailStopId(null);

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [libraryDetailStopId]);

  const openLibraryDetail = (event, stopId) => {
    if (libraryDragIntentRef.current) return;
    if (libraryDetailStopId === stopId) {
      setLibraryDetailStopId(null);
      return;
    }
    const cardBounds = event.currentTarget.getBoundingClientRect();
    const detailWidth = 344;
    const estimatedDetailHeight = 602;
    const viewportGap = 16;
    const preferredLeft = cardBounds.right + 14;
    const left = preferredLeft + detailWidth <= window.innerWidth - viewportGap
      ? preferredLeft
      : Math.max(viewportGap, cardBounds.left - detailWidth - 14);
    const top = Math.max(
      96,
      Math.min(cardBounds.top - 4, window.innerHeight - estimatedDetailHeight - viewportGap),
    );

    setLibraryDetailPosition({
      top,
      left,
      maxHeight: Math.max(360, window.innerHeight - top - viewportGap),
    });
    setLibraryDetailStopId(stopId);
    window.requestAnimationFrame(() => {
      libraryDetailRef.current?.querySelector(".library-detail-close")?.focus({
        preventScroll: true,
      });
    });
  };

  const focusLibraryCard = (stopId) => {
    setLibraryDetailStopId(null);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-library-stop-id="${stopId}"]`)?.focus({
        preventScroll: true,
      });
    });
  };

  const revealLibraryStopOnTimeline = (slot) => {
    if (!slot) return;
    setActiveStopId(slot.stopId);
    setLibraryDetailStopId(null);
    scrollTimelineNearMinute(timeToMinutes(slot.time), "smooth");
    window.requestAnimationFrame(() => {
      document.querySelector(`.timeline-place-card[data-stop-id="${slot.stopId}"]`)?.focus({
        preventScroll: true,
      });
    });
  };

  const applyDemoStep = async (step) => {
    const outcome = applyPlannerAgentDemoStep({
      timelineSlots,
      constraints,
      step,
      manuallyChangedStopIds: manualChangedStopIdsRef.current,
    });
    flushSync(() => {
      setTimelineSlots(outcome.timelineSlots);
      setConstraints(outcome.constraints);
      if (outcome.activeStopId !== null) setActiveStopId(outcome.activeStopId);
    });
    return outcome;
  };

  useEffect(() => {
    if (!isVisible || demoAgentState.phase !== "running") return undefined;
    const step = PLANNER_AGENT_DEMO_STEPS[demoAgentState.stepIndex];
    if (!step) return undefined;

    setDemoAgentState((current) => ({
      ...current,
      previewOperation: step,
    }));

    const timer = window.setTimeout(async () => {
      demoStepTimerRef.current = null;
      const outcome = await applyDemoStep(step);
      const nextStepIndex = demoAgentState.stepIndex + 1;
      const isComplete = nextStepIndex === PLANNER_AGENT_DEMO_STEPS.length;
      const preservedManualCount = manualChangedStopIdsRef.current.size;
      setDemoAgentState((current) => ({
        ...current,
        phase: isComplete ? "completed" : "running",
        stepIndex: nextStepIndex,
        previewOperation: null,
        changedStopIds: [
          ...new Set([...current.changedStopIds, ...outcome.changedStopIds]),
        ],
        messages: isComplete
          ? [
            ...current.messages,
            {
              role: "assistant",
              text: `局部调整完成：上午已经留空，只顺延了 2 个冲突地点，其余 ${Math.max(0, outcome.timelineSlots.length - 2)} 个地点保持原位。${
                preservedManualCount ? `你刚才手动调整的 ${preservedManualCount} 个地点也已保留。` : ""
              }`,
            },
          ]
          : current.messages,
      }));

      if (isComplete) {
        onToast("局部调整完成，确认行程后保存");
      }
    }, 1250);
    demoStepTimerRef.current = timer;

    return () => {
      window.clearTimeout(timer);
      if (demoStepTimerRef.current === timer) demoStepTimerRef.current = null;
    };
  }, [isVisible, demoAgentState.phase, demoAgentState.stepIndex]);

  useEffect(() => {
    if (demoAgentVisible) return;
    const constraintWasApplied = agentOperations.some((operation) => (
      operation.type === "constraint.add"
      && operation.status === "APPLIED"
    ));
    if (!constraintWasApplied) return;
    setConstraints((current) => (
      current.some((constraint) => constraint.id === "agent-time-constraint")
        ? current
        : [
          ...current,
          {
            id: "agent-time-constraint",
            label: "Agent 已写入新的不可用时间",
          },
        ]
    ));
  }, [agentOperations, demoAgentVisible]);

  useEffect(() => {
    if (demoAgentVisible) return;
    const targetClientStopId = agentPreview?.targetClientStopId;
    if (targetClientStopId === null || targetClientStopId === undefined) return;
    const matchingStop = places.find(
      (stop) => String(stop.clientStopId ?? stop.id) === String(targetClientStopId),
    );
    if (!matchingStop) return;
    setActiveStopId(matchingStop.id);
    const requestedTime = agentPreview.after?.scheduledTime;
    const currentSlot = timelineSlots.find(
      (slot) => String(slot.stopId) === String(matchingStop.id),
    );
    scrollTimelineNearMinute(
      timeToMinutes(requestedTime ?? currentSlot?.time ?? "09:00"),
      "smooth",
    );
  }, [agentPreview?.operationId, agentPreview?.sequence, demoAgentVisible]);

  useEffect(() => {
    if (isVisible || agentStatus !== "running") return;
    if (demoAgentVisible) {
      clearDemoStepTimer();
      setDemoAgentState((current) => ({
        ...current,
        phase: "paused",
        previewOperation: null,
        messages: [
          ...current.messages,
          {
            role: "assistant",
            text: "你暂时离开了规划画布，我已自动暂停。返回后可以从当前版本继续或撤回本轮。",
          },
        ],
      }));
      return;
    }
    void agent.pause().catch(() => {
      onToast("离开画布时自动暂停失败，请返回后检查 Agent 状态");
    });
  }, [isVisible, agentStatus, demoAgentVisible]);

  useEffect(() => {
    const transcript = agentTranscriptRef.current;
    if (!transcript) return;
    transcript.scrollTop = transcript.scrollHeight;
  }, [agentMessages]);

  const startAgentDemoRun = async () => {
    if (demoAgentState.isPersisting) return;
    try {
      if (agent.isActive) await agent.stop();
      agent.reset();
      const snapshot = pushUndoSnapshot("Agent：周六上午有事");
      manualChangedStopIdsRef.current = new Set();
      setAgentInput("");
      setDemoAgentState({
        ...createPlannerAgentDemoState(),
        phase: "running",
        snapshot,
        messages: [
          { id: "demo-user", role: "user", text: PLANNER_AGENT_DEMO_PROMPT },
          {
            id: "demo-assistant",
            role: "assistant",
            text: "我会保持画布和中午后的安排不动，只处理上午冲突的两个地点。",
          },
        ],
      });
      onToast("Agent 正在进行局部调整");
    } catch (error) {
      onToast(error?.message ?? "暂时无法开始 Agent 演示");
    }
  };

  const pauseAgentRun = async () => {
    if (demoAgentState.phase === "running") {
      clearDemoStepTimer();
      setDemoAgentState((current) => ({
        ...current,
        phase: "paused",
        previewOperation: null,
      }));
      onToast("Agent 已暂停");
      return;
    }
    try {
      await agent.pause();
      onToast("Agent 已暂停");
    } catch (error) {
      onToast(error?.message ?? "Agent 暂停失败");
    }
  };

  const resumeAgentRun = async () => {
    if (demoAgentState.phase === "paused") {
      setDemoAgentState((current) => ({
        ...current,
        phase: "running",
      }));
      onToast("Agent 从当前版本继续");
      return;
    }
    try {
      await agent.resume({
        baseRevisionId: tripSession?.revisionId,
      });
      onToast("Agent 从当前版本继续");
    } catch (error) {
      onToast(error?.message ?? "Agent 继续失败");
    }
  };

  const stopAgentRun = async () => {
    if (demoAgentIsActive) {
      clearDemoStepTimer();
      setDemoAgentState((current) => ({
        ...current,
        phase: "stopped",
        previewOperation: null,
      }));
      const saved = await persistDemoPlan(sortedTimelineSlots, constraints);
      onToast(saved
        ? "Agent 已停止，当前修改已保留并保存"
        : "Agent 已停止，当前修改仅保留在画布");
      return;
    }
    try {
      await agent.stop();
      onToast("Agent 已停止，当前修改已保留");
    } catch (error) {
      onToast(error?.message ?? "Agent 停止失败");
    }
  };

  const startAgentRun = async (prompt) => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return;
    if (demoAgentState.isPersisting) {
      onToast("正在保存演示结果，请稍候再发送新指令");
      return;
    }
    if (typeof onEnsureAgentDraft !== "function") {
      onToast("Agent 尚未连接到行程版本服务");
      return;
    }

    setAgentInput("");
    try {
      const hadActiveAgent = agentIsActive;
      if (demoAgentState.phase === "running") {
        clearDemoStepTimer();
        setDemoAgentState((current) => ({
          ...current,
          phase: "paused",
          previewOperation: null,
        }));
      }
      if (agent.isActive) {
        await agent.stop();
      }
      const session = await onEnsureAgentDraft(sortedTimelineSlots, {
        constraints,
        transportModeOverrides,
      });
      resetDemoAgent();
      manualChangedStopIdsRef.current = new Set();
      await agent.start(normalizedPrompt, { tripSession: session });
      onToast(hadActiveAgent ? "已从当前版本采纳你的补充意见" : "Agent 已开始逐步调整");
    } catch (error) {
      onToast(error?.message ?? "Agent 启动失败，请检查后端后重试");
    }
  };

  const undoLastChange = async () => {
    if (!undoStack.length) {
      onToast("当前已经是最早版本");
      return;
    }
    if (demoAgentState.isPersisting) {
      onToast("正在保存演示结果，请稍候再撤销");
      return;
    }
    if (!(await pauseForManualTakeover())) return;
    const snapshot = undoStack[undoStack.length - 1];
    const isDemoRunUndo = snapshot === demoAgentState.snapshot;
    restoreSnapshot(snapshot);
    setUndoStack((current) => current.slice(0, -1));
    if (isDemoRunUndo) resetDemoAgent();
    try {
      if (typeof onPersistManualPlan === "function") {
        if (demoAgentVisible && !isDemoRunUndo) {
          const saved = await persistDemoPlan(
            snapshot.timelineSlots,
            snapshot.constraints,
            snapshot.transportModeOverrides,
          );
          if (!saved) return;
        } else {
          await onPersistManualPlan(snapshot.timelineSlots, {
            constraints: snapshot.constraints,
            transportModeOverrides: snapshot.transportModeOverrides,
          });
        }
      }
      onToast(`已撤销：${snapshot.label}`);
    } catch (error) {
      onToast(error?.message ?? "撤销已显示在画布，但后端版本保存失败");
    }
  };

  const undoAgentRun = async () => {
    if (demoAgentVisible) {
      const snapshot = demoAgentState.snapshot;
      if (!snapshot || demoAgentState.isPersisting) return;
      setDemoAgentState((current) => ({
        ...current,
        phase: "undoing",
        previewOperation: null,
        isPersisting: true,
      }));
      restoreSnapshot(snapshot);
      setUndoStack((current) => {
        const snapshotIndex = current.lastIndexOf(snapshot);
        return snapshotIndex >= 0 ? current.slice(0, snapshotIndex) : current;
      });
      try {
        if (typeof onPersistManualPlan === "function") {
          await onPersistManualPlan(snapshot.timelineSlots, {
            constraints: snapshot.constraints,
            transportModeOverrides: snapshot.transportModeOverrides,
          });
        }
        resetDemoAgent();
        onToast("已撤回 Agent 演示的全部修改");
      } catch (error) {
        resetDemoAgent();
        onToast(error?.message ?? "演示已在画布撤回，但后端版本保存失败");
      }
      return;
    }
    try {
      await agent.undo();
      onToast("已撤回 Agent 本轮全部修改");
    } catch (error) {
      onToast(error?.message ?? "本轮撤回失败，请检查是否存在更新的人工版本");
    }
  };

  const confirmCurrentPlan = async () => {
    if (demoAgentState.isPersisting) {
      onToast("正在保存演示结果，请稍候再确认行程");
      return;
    }
    if (!(await pauseForManualTakeover())) return;
    if (demoAgentIsActive) {
      setDemoAgentState((current) => ({
        ...current,
        phase: "stopped",
        previewOperation: null,
      }));
    }
    if (agent.isActive) {
      try {
        await agent.stop();
      } catch (error) {
        onToast(error?.message ?? "Agent 尚未安全停止，暂时不能确认行程");
        return;
      }
    }
    await onConfirm(sortedTimelineSlots, {
      constraints,
      transportModeOverrides,
    });
  };

  const setDragPayload = (event, payload) => {
    void pauseForManualTakeover();
    const serialized = JSON.stringify(payload);
    event.dataTransfer.setData("application/x-jilu-itinerary", serialized);
    event.dataTransfer.setData("text/plain", serialized);
    event.dataTransfer.effectAllowed = "move";
    if (dragPreviewRef.current) {
      event.dataTransfer.setDragImage(dragPreviewRef.current, 18, 18);
    }
    setDraggedItem(payload);
  };

  const getDragPayload = (event) => {
    const raw = event.dataTransfer.getData("application/x-jilu-itinerary")
      || event.dataTransfer.getData("text/plain");
    if (!raw) return draggedItem;
    try {
      return JSON.parse(raw);
    } catch {
      return draggedItem;
    }
  };

  const finishDrag = () => {
    if (dragFrameRef.current) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    pendingDragGuideRef.current = null;
    setDraggedItem(null);
    setDragGuide(null);
    setIsTrashArmed(false);
  };

  const revealStop = (stopId) => {
    window.requestAnimationFrame(() => {
      document.querySelector(`.timeline-place-card[data-stop-id="${stopId}"]`)?.focus({
        preventScroll: true,
      });
    });
  };

  const getTimelineMinuteFromClientX = (clientX) => {
    const stage = timelineStageRef.current;
    if (!stage) return 0;
    const metrics = timelineMetricsRef.current;
    const bounds = stage.getBoundingClientRect();
    const contentX = clientX - bounds.left + stage.scrollLeft;
    return snapTimelineMinute((contentX - metrics.edgeGutter) / metrics.pxPerMinute);
  };

  const findSourceSlotId = (payload) => {
    if (payload?.kind === "timeline-item") return payload.slotId;
    if (payload?.kind === "library-stop") {
      return sortedTimelineSlots.find((slot) => slot.stopId === payload.stopId)?.slotId ?? null;
    }
    return null;
  };

  const isTimelineMinuteOccupied = (minutes, sourceSlotId = null) => (
    sortedTimelineSlots.some((slot) => (
      slot.slotId !== sourceSlotId && timeToMinutes(slot.time) === minutes
    ))
  );

  const scheduleDragGuide = (guide) => {
    pendingDragGuideRef.current = guide;
    if (dragFrameRef.current) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      setDragGuide(pendingDragGuideRef.current);
      dragFrameRef.current = null;
    });
  };

  const handleTimelineDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const stage = timelineStageRef.current;
    if (!stage || !draggedItem) return;
    const bounds = stage.getBoundingClientRect();
    const edgeThreshold = 64;
    if (event.clientX < bounds.left + edgeThreshold) {
      stage.scrollLeft = Math.max(0, stage.scrollLeft - 36);
    } else if (event.clientX > bounds.right - edgeThreshold) {
      stage.scrollLeft = Math.min(stage.scrollWidth - stage.clientWidth, stage.scrollLeft + 36);
    }
    const minutes = getTimelineMinuteFromClientX(event.clientX);
    const metrics = timelineMetricsRef.current;
    const sourceSlotId = findSourceSlotId(draggedItem);
    const y = Math.max(
      84,
      Math.min(event.clientY - bounds.top + stage.scrollTop, timelineSurfaceHeight - 44),
    );
    scheduleDragGuide({
      minutes,
      time: formatTimelineMinute(minutes),
      x: timelineMinuteToX(minutes, metrics),
      y,
      valid: !isTimelineMinuteOccupied(minutes, sourceSlotId),
      stopId: draggedItem.stopId,
    });
  };

  const placeTimelineItemAtMinute = async (payload, minutes, source = "manual") => {
    if (!payload || !["library-stop", "timeline-item"].includes(payload.kind)) return false;
    const sourceSlotId = findSourceSlotId(payload);
    if (isTimelineMinuteOccupied(minutes, sourceSlotId)) {
      onToast(`${formatTimelineMinute(minutes)} 已安排地点，请选择相邻的 15 分钟节点`);
      return false;
    }
    if (source === "manual") {
      if (!(await pauseForManualTakeover())) return false;
      pushUndoSnapshot(payload.kind === "timeline-item" ? "手动调整行程时间" : "从地点库添加行程");
      if (agent.state.runId || demoAgentIsActive) {
        manualChangedStopIdsRef.current.add(payload.stopId);
      }
    }
    const time = formatTimelineMinute(minutes);
    let movedStopId = payload.stopId;
    const currentSorted = sortTimelineSlots(timelineSlots);
    let nextSlots;
    if (payload.kind === "timeline-item") {
      const sourceSlot = currentSorted.find((slot) => slot.slotId === payload.slotId);
      movedStopId = sourceSlot?.stopId ?? payload.stopId;
      nextSlots = sortTimelineSlots(currentSorted.map((slot) => (
        slot.slotId === payload.slotId ? { ...slot, time } : slot
      )));
    } else {
      const existing = currentSorted.find((slot) => slot.stopId === payload.stopId);
      nextSlots = existing
        ? sortTimelineSlots(currentSorted.map((slot) => (
          slot.slotId === existing.slotId ? { ...slot, time } : slot
        )))
        : sortTimelineSlots([
        ...currentSorted,
        {
          slotId: createTimelineSlotId(),
          stopId: payload.stopId,
          time,
        },
        ]);
    }
    setTimelineSlots(nextSlots);
    setActiveStopId(movedStopId);
    scrollTimelineNearMinute(minutes, "smooth");
    revealStop(movedStopId);
    const stopName = places.find((stop) => stop.id === movedStopId)?.name ?? "地点";
    if (
      source === "manual"
      && typeof onPersistManualPlan === "function"
      && (tripSession?.tripId || demoAgentVisible)
    ) {
      try {
        if (demoAgentVisible) {
          const saved = await persistDemoPlan(
            nextSlots,
            constraints,
            transportModeOverrides,
          );
          if (!saved) return false;
        } else {
          await onPersistManualPlan(nextSlots, {
            constraints,
            transportModeOverrides,
          });
        }
      } catch (error) {
        onToast(error?.message ?? "人工修改已显示，但后端版本保存失败");
        return false;
      }
    }
    onToast(`${stopName}已安排在 ${time}，其他地点保持不动`);
    return true;
  };

  const handleTimelineDrop = async (event) => {
    event.preventDefault();
    const payload = getDragPayload(event);
    const minutes = getTimelineMinuteFromClientX(event.clientX);
    await placeTimelineItemAtMinute(payload, minutes);
    finishDrag();
  };

  const removeTimelineItem = async (slotId) => {
    const targetSlot = sortedTimelineSlots.find((slot) => slot.slotId === slotId);
    if (!targetSlot) return;
    if (!(await pauseForManualTakeover())) return;
    pushUndoSnapshot("删除行程节点");
    if (agent.state.runId || demoAgentIsActive) {
      manualChangedStopIdsRef.current.add(targetSlot.stopId);
    }
    const nextSlots = sortedTimelineSlots.filter((slot) => slot.slotId !== slotId);
    setTimelineSlots(nextSlots);
    if (targetSlot.stopId === activeStopId) setActiveStopId(nextSlots[0]?.stopId ?? null);
    const stopName = places.find((stop) => stop.id === targetSlot.stopId)?.name ?? "行程节点";
    if (
      typeof onPersistManualPlan === "function"
      && (tripSession?.tripId || demoAgentVisible)
    ) {
      try {
        if (demoAgentVisible) {
          const saved = await persistDemoPlan(
            nextSlots,
            constraints,
            transportModeOverrides,
          );
          if (!saved) return;
        } else {
          await onPersistManualPlan(nextSlots, {
            constraints,
            transportModeOverrides,
          });
        }
      } catch (error) {
        onToast(error?.message ?? "删除已显示，但后端版本保存失败");
        return;
      }
    }
    onToast(`已删除${stopName}，不保留空时间节点`);
  };

  const moveTimelineItemByMinutes = async (slotId, offset) => {
    const slot = sortedTimelineSlots.find((item) => item.slotId === slotId);
    if (!slot) return;
    const nextMinutes = snapTimelineMinute(timeToMinutes(slot.time) + offset);
    if (nextMinutes === timeToMinutes(slot.time)) return;
    if (isTimelineMinuteOccupied(nextMinutes, slotId)) {
      onToast(`${formatTimelineMinute(nextMinutes)} 已安排地点`);
      return;
    }
    await placeTimelineItemAtMinute(
      { kind: "timeline-item", slotId, stopId: slot.stopId },
      nextMinutes,
    );
  };

  const handleTrashDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const payload = getDragPayload(event);
    if (payload?.kind !== "timeline-item") {
      finishDrag();
      return;
    }
    await removeTimelineItem(payload.slotId);
    finishDrag();
  };

  const startCanvasPan = (event) => {
    if (event.button !== 0 || event.target.closest("article, button, .timeline-trash-zone")) return;
    const stage = timelineStageRef.current;
    if (!stage) return;
    canvasPanRef.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: stage.scrollLeft,
    };
    stage.setPointerCapture(event.pointerId);
    setIsCanvasPanning(true);
  };

  const moveCanvasPan = (event) => {
    if (!canvasPanRef.current.active || !timelineStageRef.current) return;
    const delta = event.clientX - canvasPanRef.current.startX;
    timelineStageRef.current.scrollLeft = canvasPanRef.current.scrollLeft - delta;
  };

  const stopCanvasPan = (event) => {
    if (!canvasPanRef.current.active) return;
    canvasPanRef.current.active = false;
    if (timelineStageRef.current?.hasPointerCapture(event.pointerId)) {
      timelineStageRef.current.releasePointerCapture(event.pointerId);
    }
    setIsCanvasPanning(false);
  };

  return (
    <main
      className="page timeline-planner-page"
      hidden={!isVisible}
      aria-hidden={isVisible ? undefined : "true"}
    >
      <section className="planner-commandbar">
        <div className="planner-command-title">
          <span className="brand-mark"><MagicWandIcon /></span>
          <span>
            <small>
              {sourceImport ? "小红书灵感 · 用户主动交接" : "旅行规划画布"}
            </small>
            <h1>{sourceImport?.extraction?.title ?? "北京胡同艺文计划"}</h1>
          </span>
        </div>
        <div className="planner-history-actions">
          <button
            type="button"
            onClick={undoLastChange}
            aria-label="撤销上一步"
            disabled={!undoStack.length || demoAgentState.isPersisting}
          >
            <ArrowLeftIcon />
          </button>
          <button type="button" onClick={() => onToast("没有可重做的修改")} aria-label="重做"><ArrowRightIcon /></button>
        </div>
        <div className="planner-command-actions">
          <button type="button" className="ghost-button" onClick={() => onToast("协作链接已复制")}>
            <PersonIcon />
            邀请协作
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={async () => {
              if (demoAgentState.isPersisting) {
                onToast("正在保存演示结果，请稍候再恢复原路线");
                return;
              }
              if (!(await pauseForManualTakeover())) return;
              if (agent.isActive) await agent.stop();
              pushUndoSnapshot("恢复创作者原始路线");
              const originalTimeline = cloneInitialTimelineSlots();
              setTimelineSlots(originalTimeline);
              setConstraints([]);
              setTransportModeOverrides({});
              resetDemoAgent();
              agent.reset();
              manualChangedStopIdsRef.current = new Set();
              setActiveStopId(1);
              scrollTimelineNearMinute(9 * 60);
              if (typeof onPersistManualPlan === "function") {
                try {
                  await onPersistManualPlan(originalTimeline, {
                    constraints: [],
                    transportModeOverrides: {},
                  });
                } catch (error) {
                  onToast(error?.message ?? "已恢复原路线，但后端版本保存失败");
                  return;
                }
              }
              onToast("已恢复创作者原始顺序");
            }}
          >
            <ReloadIcon />
            恢复原路线
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={sortedTimelineSlots.length === 0 || isConfirming}
            onClick={confirmCurrentPlan}
          >
            {isConfirming ? "正在保存…" : "确认行程"}
            <ArrowRightIcon />
          </button>
        </div>
      </section>

      <section className="timeline-workbench">
        <aside className="planner-library">
          <header>
            <h2>收藏</h2>
            <button type="button" onClick={() => onToast("可按类型、距离和开放状态筛选")} aria-label="筛选地点">
              <MixerHorizontalIcon />
            </button>
          </header>
          <div
            className="planner-library-list"
            onScroll={() => {
              if (libraryDetailStopId) setLibraryDetailStopId(null);
            }}
          >
            {places.map((stop) => {
              const scheduled = timelineSlots.some((slot) => slot.stopId === stop.id);
              return (
                <article
                  key={stop.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  data-library-stop-id={stop.id}
                  data-library-layout="vertical"
                  data-scheduled={scheduled ? "true" : "false"}
                  data-detail-open={libraryDetailStopId === stop.id ? "true" : "false"}
                  aria-haspopup="dialog"
                  aria-controls={libraryDetailStopId === stop.id ? "library-place-detail" : undefined}
                  aria-expanded={libraryDetailStopId === stop.id}
                  aria-label={`查看${stop.name}详情，或拖动到时间轴安排`}
                  className={[
                    activeStopId === stop.id ? "active" : "",
                    libraryDetailStopId === stop.id ? "detail-open" : "",
                  ].filter(Boolean).join(" ")}
                  onPointerDown={() => {
                    libraryDragIntentRef.current = false;
                  }}
                  onClick={(event) => openLibraryDetail(event, stop.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openLibraryDetail(event, stop.id);
                    }
                  }}
                  onDragStart={(event) => {
                    libraryDragIntentRef.current = true;
                    setLibraryDetailStopId(null);
                    setDragPayload(event, { kind: "library-stop", stopId: stop.id });
                  }}
                  onDragEnd={() => {
                    finishDrag();
                    window.setTimeout(() => {
                      libraryDragIntentRef.current = false;
                    }, 0);
                  }}
                >
                  <span className="library-card-handle" aria-hidden="true"><DragHandleDots2Icon /></span>
                  <img data-library-image src={stop.image} alt={`${stop.name}实景`} />
                  <div className="library-card-copy" data-library-copy>
                    <strong>{stop.libraryTitle}</strong>
                    <span className="library-card-creator">
                      <img src={stop.libraryAvatar} alt="" />
                      <span>{stop.libraryCreator}</span>
                    </span>
                  </div>
                  <BookmarkIcon className="library-card-bookmark" />
                </article>
              );
            })}
          </div>
        </aside>

        {libraryDetailStop ? (
          <aside
            ref={libraryDetailRef}
            id="library-place-detail"
            className="library-detail-popover"
            data-library-detail-id={libraryDetailStop.id}
            data-scheduled-time={libraryDetailSlot?.time ?? ""}
            role="dialog"
            aria-modal="false"
            aria-labelledby="library-place-detail-title"
            style={{
              top: `${libraryDetailPosition.top}px`,
              left: `${libraryDetailPosition.left}px`,
              maxHeight: `${libraryDetailPosition.maxHeight}px`,
            }}
          >
            <div className="library-detail-hero">
              <img src={libraryDetailStop.image} alt={`${libraryDetailStop.name}地点详情`} />
              <button
                type="button"
                className="library-detail-close"
                data-library-detail-close
                onClick={() => focusLibraryCard(libraryDetailStop.id)}
                aria-label={`关闭${libraryDetailStop.name}详情`}
              >
                <Cross2Icon />
              </button>
              <span className={libraryDetailSlot ? "scheduled" : ""}>
                {libraryDetailSlot ? `已安排 · ${libraryDetailSlot.time}` : "旅行灵感 · 尚未安排"}
              </span>
            </div>

            <div className="library-detail-body">
              <header>
                <small>{libraryDetailStop.type}</small>
                <h3 id="library-place-detail-title">{libraryDetailStop.name}</h3>
                <p>{libraryDetailStop.note}</p>
              </header>

              <dl className="library-detail-facts">
                <div>
                  <dt><ClockIcon />建议停留</dt>
                  <dd>{libraryDetailStop.duration}</dd>
                </div>
                <div>
                  <dt><BookmarkIcon />预计花费</dt>
                  <dd>{libraryDetailStop.cost}</dd>
                </div>
                <div>
                  <dt><DrawingPinIcon />{libraryDetailSlot ? "路线衔接" : "建议到访"}</dt>
                  <dd>{libraryDetailSlot ? libraryDetailStop.travel : `${libraryDetailStop.time} 左右`}</dd>
                </div>
              </dl>

              <div className="library-detail-source">
                <img src={libraryDetailStop.libraryAvatar} alt="" />
                <span>
                  <small>来自创作者路线</small>
                  <strong>{libraryDetailStop.libraryCreator}</strong>
                </span>
                <em className={`library-tag ${libraryDetailStop.libraryTone}`}>
                  {libraryDetailStop.libraryTag}
                </em>
              </div>
            </div>

            <footer>
              <span>
                {libraryDetailSlot ? <CheckCircledIcon /> : <DragHandleDots2Icon />}
                {libraryDetailSlot ? "已加入当前时间轴" : "关闭详情后可直接拖动"}
              </span>
              <button
                type="button"
                onClick={() => (
                  libraryDetailSlot
                    ? revealLibraryStopOnTimeline(libraryDetailSlot)
                    : focusLibraryCard(libraryDetailStop.id)
                )}
              >
                {libraryDetailSlot ? "查看时间轴位置" : "回到卡片，开始拖动"}
                <ArrowRightIcon />
              </button>
            </footer>
          </aside>
        ) : null}

        <section className="timeline-canvas">
          <header className="timeline-canvas-heading">
            <div>
              <small>Day 1 · 7 月 25 日</small>
            </div>
            {demoAgentVisible
              && ["running", "paused"].includes(agentStatus)
              && agentPreview ? (
              <div
                className={`timeline-agent-process ${agentStatus}`}
                role="status"
                aria-live="polite"
              >
                <span className="timeline-agent-process-icon"><MagicWandIcon /></span>
                <span className="timeline-agent-process-copy">
                  <small>
                    Agent 步骤 {Math.min(demoAgentState.stepIndex + 1, PLANNER_AGENT_DEMO_STEPS.length)}
                    /{PLANNER_AGENT_DEMO_STEPS.length}
                  </small>
                  <strong>{agentPreview.title}</strong>
                </span>
                <span className="timeline-agent-process-dots" aria-hidden="true">
                  {PLANNER_AGENT_DEMO_STEPS.map((step, index) => (
                    <i
                      key={step.operationId}
                      className={[
                        index < demoAgentState.stepIndex ? "complete" : "",
                        index === demoAgentState.stepIndex ? "current" : "",
                      ].filter(Boolean).join(" ")}
                    />
                  ))}
                </span>
              </div>
            ) : null}
            <div className="timeline-canvas-tools">
              <div className="timeline-zoom-controls" role="group" aria-label="画布缩放">
                <button
                  type="button"
                  data-zoom-action="out"
                  onClick={() => stepTimelineZoom(-1)}
                  disabled={timelineZoom <= TIMELINE_ZOOM_MIN || Boolean(draggedItem) || isCanvasPanning}
                  aria-label="缩小画布"
                  title="缩小画布"
                >
                  <MinusIcon />
                </button>
                <output
                  aria-live="polite"
                  aria-label={`当前画布缩放 ${Math.round(timelineZoom * 100)}%`}
                  title="触控板捏合也可以缩放"
                >
                  {Math.round(timelineZoom * 100)}%
                </output>
                <button
                  type="button"
                  data-zoom-action="in"
                  onClick={() => stepTimelineZoom(1)}
                  disabled={timelineZoom >= TIMELINE_ZOOM_MAX || Boolean(draggedItem) || isCanvasPanning}
                  aria-label="放大画布"
                  title="放大画布"
                >
                  <PlusIcon />
                </button>
                <button
                  type="button"
                  className={timelineZoomMode === "fit" ? "active" : ""}
                  data-zoom-action="fit"
                  onClick={fitTimelineToView}
                  disabled={Boolean(draggedItem) || isCanvasPanning}
                  aria-label="全局适配画布"
                  aria-pressed={timelineZoomMode === "fit"}
                  title="显示完整行程"
                >
                  <DashboardIcon />
                  <span>全览</span>
                </button>
                <button
                  type="button"
                  data-zoom-action="reset"
                  onClick={() => applyTimelineZoom(TIMELINE_ZOOM_DEFAULT)}
                  disabled={
                    (Math.abs(timelineZoom - TIMELINE_ZOOM_DEFAULT) < 0.001 && timelineZoomMode === "manual")
                    || Boolean(draggedItem)
                    || isCanvasPanning
                  }
                  aria-label="恢复默认缩放"
                  title="恢复 100%"
                >
                  <ReloadIcon />
                </button>
              </div>
            </div>
          </header>

          <div ref={dragPreviewRef} className="timeline-native-drag-preview" aria-hidden="true">
            <span />
          </div>

          <div
            ref={timelineStageRef}
            className={`timeline-stage ${draggedItem ? "drag-ready" : ""} ${isCanvasPanning ? "panning" : ""}`}
            data-zoom={timelineZoom.toFixed(3)}
            data-zoom-mode={timelineZoomMode}
            tabIndex={0}
            aria-label={`24 小时规划画布，当前缩放 ${Math.round(timelineZoom * 100)}%。可在触控板上捏合缩放，也可按住 Control 或 Command 配合加号、减号缩放，按 0 恢复默认。`}
            onDragOver={handleTimelineDragOver}
            onDrop={handleTimelineDrop}
            onKeyDown={handleTimelineZoomShortcut}
            onPointerDown={startCanvasPan}
            onPointerMove={moveCanvasPan}
            onPointerUp={stopCanvasPan}
            onPointerCancel={stopCanvasPan}
          >
            <div
              className="timeline-day-surface"
              data-zoom-density={timelineZoom <= 0.4 ? "overview" : "detail"}
              style={{
                width: `${timelineMetrics.surfaceWidth}px`,
                height: `${timelineSurfaceHeight}px`,
                "--timeline-hour-width": `${timelineMetrics.hourWidth}px`,
                "--timeline-quarter-width": `${timelineMetrics.quarterWidth}px`,
                "--timeline-edge-gutter": `${timelineMetrics.edgeGutter}px`,
                "--timeline-card-width": `${timelineMetrics.cardWidth}px`,
                "--timeline-card-height": `${timelineMetrics.cardHeight}px`,
                 "--timeline-card-image-height": `${timelineMetrics.cardImageHeight}px`,
                 "--timeline-card-radius": `${timelineMetrics.cardRadius}px`,
                 "--timeline-card-inner-padding": `${timelineMetrics.cardInnerPadding}px`,
                 "--timeline-card-copy-padding": `${timelineMetrics.cardCopyPadding}px`,
                "--timeline-card-copy-gap": `${timelineMetrics.cardCopyGap}px`,
                "--timeline-card-title-size": `${timelineMetrics.cardTitleFontSize}px`,
                "--timeline-card-meta-size": `${timelineMetrics.cardMetaFontSize}px`,
                "--timeline-card-time-size": `${timelineMetrics.cardTimeFontSize}px`,
                "--timeline-card-time-min-width": `${timelineMetrics.cardTimeMinWidth}px`,
                "--timeline-card-time-padding-y": `${timelineMetrics.cardTimePaddingY}px`,
                "--timeline-card-time-padding-x": `${timelineMetrics.cardTimePaddingX}px`,
                "--timeline-axis-font-size": `${timelineMetrics.axisFontSize}px`,
                "--timeline-annotation-font-size": `${timelineMetrics.annotationFontSize}px`,
              }}
            >
              <div className="timeline-axis" aria-label="00:00 到 24:00 时间轴">
                {axisTicks.map((tick) => (
                  <span
                    key={tick.minutes}
                    data-axis-minute={tick.minutes}
                    style={{ left: `${timelineMinuteToX(tick.minutes, timelineMetrics)}px` }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>

              {hasMorningConstraint ? (
                <div
                  className="timeline-unavailable"
                  style={{
                    left: `${timelineMinuteToX(9 * 60, timelineMetrics)}px`,
                    width: `${3 * 60 * timelineMetrics.pxPerMinute}px`,
                  }}
                  aria-label="周六上午九点到十二点不可安排"
                >
                  <span><ClockIcon />09:00—12:00 已占用</span>
                </div>
              ) : null}

              {timelineTransportLegs.map((leg) => (
                <div
                  key={`connector-${leg.id}`}
                  className={`timeline-route-connector ${leg.conflict ? "conflict" : ""}`}
                  data-connector-from-slot-id={leg.fromSlotId}
                  data-connector-to-slot-id={leg.toSlotId}
                  style={{
                    left: `${leg.connectorLeft}px`,
                    top: `${leg.connectorTop}px`,
                    width: `${Math.max(2, leg.connectorWidth)}px`,
                    height: `${Math.max(2, leg.connectorHeight)}px`,
                  }}
                  aria-hidden="true"
                >
                  <span
                    className="timeline-route-line timeline-route-line-from"
                    style={{
                      left: `${Math.min(leg.fromConnectorX, leg.bendConnectorX)}px`,
                      top: `${leg.fromRailY - leg.connectorTop}px`,
                      width: `${Math.abs(leg.bendConnectorX - leg.fromConnectorX)}px`,
                    }}
                  />
                  <span
                    className="timeline-route-line timeline-route-line-to"
                    style={{
                      left: `${Math.min(leg.toConnectorX, leg.bendConnectorX)}px`,
                      top: `${leg.toRailY - leg.connectorTop}px`,
                      width: `${Math.abs(leg.bendConnectorX - leg.toConnectorX)}px`,
                    }}
                  />
                  {leg.fromRailY !== leg.toRailY
                    ? (
                      <span
                        className="timeline-route-line timeline-route-line-vertical"
                        style={{
                          left: `${leg.bendConnectorX}px`,
                          top: `${Math.min(leg.fromRailY, leg.toRailY) - leg.connectorTop}px`,
                          height: `${Math.abs(leg.toRailY - leg.fromRailY)}px`,
                        }}
                      />
                    )
                    : null}
                </div>
              ))}

              {timelineLayout.items.map((slot) => (
                <span
                  key={`route-stem-${slot.slotId}`}
                  className="timeline-route-line timeline-route-stem timeline-route-card-stem"
                  data-route-stem-slot-id={slot.slotId}
                  style={{
                    left: `${slot.x}px`,
                    top: `${slot.top + timelineMetrics.cardHeight}px`,
                    height: `${timelineMetrics.routeLaneOffset}px`,
                  }}
                  aria-hidden="true"
                />
              ))}

              {timelineLayout.items.map((slot, index) => {
                const hasConflict = Boolean(timelineTransportLegs[index]?.conflict);
                return (
                  <div
                    key={`stay-${slot.slotId}`}
                    className={`timeline-duration-bar ${hasConflict ? "conflict" : ""}`}
                    data-stay-bar-slot-id={slot.slotId}
                    data-start-minutes={slot.minutes}
                    data-end-minutes={slot.endMinutes}
                    data-duration-minutes={slot.durationMinutes}
                    data-conflict={hasConflict ? "true" : "false"}
                    style={{
                      left: `${slot.x}px`,
                      top: `${slot.top + timelineMetrics.cardHeight + timelineMetrics.durationLaneOffset}px`,
                      width: `${slot.durationWidth}px`,
                    }}
                    aria-hidden="true"
                  >
                    <span>{formatDurationLabel(slot.durationMinutes)}</span>
                  </div>
                );
              })}

              {timelineLayout.items.map((slot) => {
                        const stop = places.find((item) => item.id === slot.stopId);
                if (!stop) return null;
                const isDragging = draggedItem?.kind === "timeline-item"
                  && draggedItem.slotId === slot.slotId;
                const clientStopId = String(stop.clientStopId ?? stop.id);
                const previewStopIds = [
                  ...(agentPreview?.stopIds ?? []),
                  ...(agentPreview?.protectedStopIds ?? []),
                ].map(String);
                const isDirectAgentPreviewTarget = (
                  agentPreview?.targetClientStopId !== null
                  && agentPreview?.targetClientStopId !== undefined
                  && String(agentPreview.targetClientStopId) === clientStopId
                );
                const isAgentPreviewTarget = isDirectAgentPreviewTarget
                  || previewStopIds.includes(clientStopId);
                const isAgentProtected = agentPreview?.kind === "protect"
                  && previewStopIds.includes(clientStopId);
                const wasAgentChanged = agentChangedStopIds.some(
                  (changedStopId) => String(changedStopId) === clientStopId,
                );
                return (
                  <article
                    key={slot.slotId}
                    data-slot-id={slot.slotId}
                    data-stop-id={stop.id}
                    data-time={slot.time}
                    data-start-minutes={slot.minutes}
                    data-end-minutes={slot.endMinutes}
                    data-duration-minutes={slot.durationMinutes}
                    data-time-range={`${slot.time}–${slot.endTime}`}
                    data-track={slot.track}
                    className={[
                       "timeline-place-card",
                       activeStopId === stop.id ? "active" : "",
                        isDragging ? "dragging" : "",
                        isAgentPreviewTarget ? "agent-moving" : "",
                        isAgentProtected ? "agent-protected" : "",
                        wasAgentChanged ? "agent-changed" : "",
                     ].filter(Boolean).join(" ")}
                     style={{
                       left: `${slot.x}px`,
                       top: `${slot.top}px`,
                       viewTransitionName: `planner-stop-${stop.id}`,
                     }}
                    draggable
                    tabIndex={0}
                    aria-label={`${slot.time} 到 ${slot.endTime} 的${stop.name}。左右拖动可精确调整时间，向下拖动可直接删除。`}
                    onClick={() => setActiveStopId(stop.id)}
                    onDragStart={(event) => setDragPayload(event, {
                      kind: "timeline-item",
                      slotId: slot.slotId,
                      stopId: stop.id,
                    })}
                    onDragEnd={finishDrag}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft") {
                        event.preventDefault();
                        moveTimelineItemByMinutes(slot.slotId, -TIMELINE_SNAP_MINUTES);
                      }
                      if (event.key === "ArrowRight") {
                        event.preventDefault();
                        moveTimelineItemByMinutes(slot.slotId, TIMELINE_SNAP_MINUTES);
                      }
                      if (event.key === "Delete" || event.key === "Backspace") {
                        event.preventDefault();
                        removeTimelineItem(slot.slotId);
                      }
                    }}
                   >
                      {isAgentPreviewTarget ? (
                        <span className={`timeline-agent-badge ${isAgentProtected ? "protected" : ""}`}>
                          {isAgentProtected ? <CheckCircledIcon /> : <MagicWandIcon />}
                          {isAgentProtected
                            ? "保持原位"
                            : agentPreview.type === "stop.move"
                              ? "准备顺延"
                              : "Agent 正在处理"}
                        </span>
                     ) : wasAgentChanged ? (
                       <span className="timeline-agent-badge changed"><CheckCircledIcon />已调整</span>
                     ) : null}
                     <img data-slot-image-frame src={stop.image} alt="" />
                    <div data-slot-copy>
                      <strong>{stop.name}</strong>
                      <span>{stop.type}</span>
                      <span className="timeline-time-range" data-slot-time-range>
                        <time>{slot.time}</time>
                        <i aria-hidden="true" />
                        <time>{slot.endTime}</time>
                      </span>
                    </div>
                  </article>
                );
              })}

              {timelineTransportLegs.map((leg) => {
                const ModeIcon = {
                  walk: PersonSimpleWalkIcon,
                  bike: BicycleIcon,
                  taxi: CarProfileIcon,
                }[leg.mode] ?? PersonSimpleWalkIcon;
                const currentModeIndex = Math.max(0, leg.availableModes.indexOf(leg.mode));
                const nextMode = leg.availableModes[
                  (currentModeIndex + 1) % leg.availableModes.length
                ];
                const nextModeLabel = TIMELINE_TRANSPORT_MODE_LABELS[nextMode];
                return (
                  <button
                    type="button"
                    key={leg.id}
                    className={`timeline-transport-node ${leg.conflict ? "conflict" : ""}`}
                    style={{
                      left: `${leg.x}px`,
                      top: `${leg.top}px`,
                    }}
                    data-transport-from-slot-id={leg.fromSlotId}
                    data-transport-to-slot-id={leg.toSlotId}
                    data-mode={leg.mode}
                    data-mode-options={leg.availableModes.join(",")}
                    data-next-mode={nextMode}
                    data-duration-minutes={leg.plannedGapMinutes}
                    data-estimated-duration-minutes={leg.estimatedTravelMinutes}
                    data-planned-gap-minutes={leg.plannedGapMinutes}
                    data-buffer-minutes={leg.bufferMinutes}
                    data-conflict-minutes={leg.conflictMinutes}
                    data-from-end-minutes={leg.fromEndMinutes}
                    data-to-start-minutes={leg.toStartMinutes}
                    data-distance-km={Number.parseFloat(leg.distance)}
                    data-estimated-cost={leg.estimatedCost}
                    data-conflict={leg.conflict ? "true" : "false"}
                    onClick={() => cycleTimelineTransportMode(leg)}
                    title={`点击切换为${nextModeLabel}`}
                    aria-label={`${leg.fromStopName}到${leg.toStopName}，${leg.label} ${leg.travelMinutes} 分钟，${leg.distance}，费用${leg.estimatedCost}，${
                      leg.conflict
                        ? `时间冲突 ${leg.conflictMinutes} 分钟`
                        : `空档 ${leg.bufferMinutes} 分钟`
                    }。点击切换为${nextModeLabel}`}
                  >
                    <span className={`timeline-buffer-label ${leg.conflict ? "conflict" : ""}`}>
                      {leg.conflict
                        ? `冲突 ${leg.conflictMinutes} 分钟`
                        : leg.bufferMinutes > 0
                          ? `空档 ${leg.bufferMinutes} 分钟`
                          : "衔接刚好"}
                    </span>
                    <span className="timeline-transport-icon">
                      <ModeIcon size={21} weight="bold" aria-hidden="true" />
                      <i className="timeline-transport-switch" aria-hidden="true">
                        <ReloadIcon />
                      </i>
                    </span>
                    <span className="timeline-transport-copy" data-transport-content>
                      <strong>{leg.conflict ? `衔接冲突 · ${leg.label}` : leg.label}</strong>
                      <small>{leg.travelMinutes} 分钟 · {leg.distance}</small>
                      <small>预估 {leg.estimatedCost}</small>
                    </span>
                  </button>
                );
              })}

              {sortedTimelineSlots.length === 0 ? (
                <div
                  className="timeline-empty-canvas-message"
                  style={{ left: `${timelineMinuteToX(9 * 60, timelineMetrics)}px` }}
                >
                  <MagicWandIcon />
                  <strong>把左侧地点拖到任意时间</strong>
                  <span>画布会自动吸附到最近的 15 分钟</span>
                </div>
              ) : null}

              {dragGuide ? (
                <div
                  className={`timeline-drop-guide ${dragGuide.valid ? "" : "invalid"}`}
                  data-time={dragGuide.time}
                  style={{ left: `${dragGuide.x}px` }}
                  aria-hidden="true"
                >
                  <span className="timeline-drop-time">{dragGuide.time}</span>
                  <span
                    className="timeline-drop-line"
                    style={{ height: `${Math.max(28, dragGuide.y - 42)}px` }}
                  />
                  <span className="timeline-drop-point" style={{ top: `${dragGuide.y}px` }} />
                  {dragGuideStop ? (
                    <span className="timeline-drop-ghost" style={{ top: `${dragGuide.y + 14}px` }}>
                      <img src={dragGuideStop.image} alt="" />
                      <span>{dragGuideStop.name}</span>
                    </span>
                  ) : null}
                  {!dragGuide.valid ? <em>该时间已有安排</em> : null}
                </div>
              ) : null}

            </div>
          </div>

          {draggedItem?.kind === "timeline-item" ? (
            <div
              className={`timeline-trash-zone ${isTrashArmed ? "armed" : ""}`}
              data-state={isTrashArmed ? "armed" : "idle"}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsTrashArmed(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setIsTrashArmed(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setIsTrashArmed(false);
              }}
              onDrop={handleTrashDrop}
            >
              <TrashIcon />
              <span>
                <strong>{isTrashArmed ? "松开删除此行程节点" : "向下拖到这里删除"}</strong>
                <small>删除后不保留空时间节点</small>
              </span>
            </div>
          ) : null}

          <footer
            className={`timeline-canvas-status ${hasTimelineConflict ? "has-conflict" : ""}`}
            aria-live="polite"
          >
            <span aria-hidden="true">
              {agentIsWorking ? <MagicWandIcon /> : <CheckCircledIcon />}
            </span>
            <p>
              {agentIsWorking
                ? "Agent 正在局部重排 · 其他地点保持原位"
                : hasTimelineConflict
                  ? "当前行程存在时间冲突 · 调整重叠卡片即可"
                  : hasMorningConstraint
                    ? "周六上午已留空 · 中午后 4 个地点未动"
                    : `${sortedTimelineSlots.length} 个行程节点 · 所有时间均按 15 分钟对齐`}
            </p>
          </footer>
        </section>

        <aside className="planner-inspector">
          <section className="planner-mini-map">
            <RouteMap
              places={plannerMapPlaces}
              orderedStopIds={orderedStopIds}
              activeStopId={activeStopId}
              onSelect={setActiveStopId}
              compact
            />
            {activeStop && activeSlot ? (
              <div className="planner-map-selection" aria-live="polite">
                <img src={activeStop.image} alt="" />
                <span>
                  <small>{activeSlot.time}</small>
                  <strong>{activeStop.name}</strong>
                </span>
              </div>
            ) : null}
            <div className="planner-map-stats">
              <div>
                <small>地点</small>
                <strong>{sortedTimelineSlots.length} 站</strong>
              </div>
              <div>
                <small>起止时间</small>
                <strong>{earliestMinutes === null ? "—" : `${formatTimelineMinute(earliestMinutes)}–${formatTimelineMinute(latestEndMinutes)}`}</strong>
              </div>
              <div>
                <small>总时长</small>
                <strong>{earliestMinutes === null ? "—" : `${Math.max(1, Math.round((latestEndMinutes - earliestMinutes) / 60))} h`}</strong>
              </div>
              <div title="包含当前地点与交通方式的预估费用">
                <small>金额</small>
                <strong data-planner-total-cost>{earliestMinutes === null ? "—" : timelineEstimatedAmount}</strong>
              </div>
            </div>
          </section>

          <section
            className={`planner-agent-card ${agentStatus}`}
            aria-label="行程 Agent"
            data-agent-mode={demoAgentVisible ? "demo" : "live"}
            data-agent-step-index={demoAgentVisible ? demoAgentState.stepIndex : undefined}
          >
            {agentStatus === "idle" ? null : (
              <header className="agent-panel-header">
                <span className="agent-heading">
                  <i aria-hidden="true"><MagicWandIcon /></i>
                  <span>
                    <small>行程 Agent</small>
                    <strong>{agentStatusLabel}</strong>
                  </span>
                </span>
                <span className={`agent-presence ${agentStatus}`} aria-label={agentStatusLabel}>
                  <i />
                  {agentIsWorking
                    ? "LIVE"
                    : agentStatus === "paused"
                      ? "PAUSED"
                      : agentConnection === "reconnecting"
                        ? "SYNC"
                        : "READY"}
                </span>
              </header>
            )}

            <div className="agent-dialogue-body">
              {agentStatus !== "idle"
                && agentMessages.length
                && !(demoAgentVisible && agentStatus === "completed") ? (
                <div className="agent-transcript" ref={agentTranscriptRef} aria-live="polite">
                  {agentMessages.slice(demoAgentVisible ? -1 : -4).map((message, index) => (
                    <p
                      className={message.role === "assistant" ? "agent" : message.role}
                      key={message.id ?? `${message.role}-${index}-${message.text}`}
                    >
                      <span>{["agent", "assistant"].includes(message.role) ? "Agent" : "你"}</span>
                      {message.text}
                    </p>
                  ))}
                </div>
              ) : null}
              {agentError ? (
                <p className="agent-inline-error" role="alert">
                  {agentError.message}
                </p>
              ) : null}

              {agentStatus === "idle" ? (
                <button
                  type="button"
                  className="agent-example-prompt"
                  aria-label="AI 建议：我周六上午有事，请帮我重新规划"
                  onClick={startAgentDemoRun}
                >
                  <MagicWandIcon />
                  <span>
                    <small>AI 建议</small>
                    <strong>我周六上午有事，请帮我重新规划</strong>
                  </span>
                  <ChevronRightIcon />
                </button>
              ) : demoAgentVisible
                && agentStatus === "completed"
                && demoResultRows.length ? (
                <section className="agent-demo-result" aria-label="本轮局部调整结果">
                  <header>
                    <span><CheckCircledIcon /></span>
                    <div>
                      <small>调整结果</small>
                      <strong>只改动了必要的两处</strong>
                    </div>
                  </header>
                  <div className="agent-demo-result-metrics">
                    <span><strong>{demoResultRows.length}</strong> 个地点顺延</span>
                    <span><strong>{demoUnchangedStopCount}</strong> 个地点未动</span>
                  </div>
                  <ul>
                    {demoResultRows.map((row) => (
                      <li key={row.stopId}>
                        <strong>{row.name}</strong>
                        <span>
                          <time>{row.previousTime}</time>
                          <ArrowRightIcon />
                          <time>{row.currentTime}</time>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p>地图、交通方式和中午后的路线顺序均已保留。</p>
                </section>
              ) : agentOperations.length ? (
                <ol className="agent-operation-list">
                  {agentOperations.map((operation, index) => {
                    const isComplete = operation.status === "APPLIED";
                    const isCurrent = operation.status === "STARTED";
                    const isFailed = operation.status === "FAILED";
                    return (
                      <li
                        key={operation.operationId}
                        className={[
                          isComplete ? "complete" : "",
                          isCurrent ? "current" : "",
                          isCurrent && ["pausing", "paused"].includes(agentStatus) ? "paused" : "",
                          isFailed ? "failed" : "",
                        ].filter(Boolean).join(" ")}
                      >
                        <span>{isComplete ? <CheckCircledIcon /> : index + 1}</span>
                        <div>
                          <strong>{operation.title ?? "调整行程"}</strong>
                          <small>{operation.detail ?? operation.reason ?? "正在校验这一步修改"}</small>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : agentStatus !== "idle" ? (
                <ol className="agent-operation-list">
                  <li className="current">
                    <span><MagicWandIcon /></span>
                    <div>
                      <strong>{agentStatusLabel}</strong>
                      <small>模型正在读取当前行程和最新版本约束</small>
                    </div>
                  </li>
                </ol>
              ) : null}

              {agentControlsVisible ? (
                <div className="agent-live-controls">
                  {agentCanPause ? (
                    <button
                      type="button"
                      onClick={pauseAgentRun}
                    >
                      <MinusIcon />
                      暂停
                    </button>
                  ) : agentCanResume ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={resumeAgentRun}
                    >
                      <ArrowRightIcon />
                      继续
                    </button>
                  ) : null}
                  {agentCanStop ? (
                    <button
                      type="button"
                      onClick={stopAgentRun}
                    >
                      停止
                    </button>
                  ) : null}
                  <button type="button" onClick={undoAgentRun} disabled={!agentCanUndo}>
                    <ReloadIcon />
                    撤回本轮
                  </button>
                  {!demoAgentVisible && !agent.isActive ? (
                    <button
                      type="button"
                      onClick={() => {
                        agent.reset();
                        onToast("已返回 AI 建议");
                      }}
                    >
                      返回建议
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <form
              className="agent-composer"
              onSubmit={(event) => {
                event.preventDefault();
                startAgentRun(agentInput);
              }}
            >
              <textarea
                value={agentInput}
                onChange={(event) => setAgentInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    startAgentRun(agentInput);
                  }
                }}
                placeholder={agentIsActive
                  ? "补充你的想法，Agent 会先暂停再重新检查…"
                  : "问问 Agent，例如：周六上午有事，帮我重新规划…"}
                aria-label="给行程 Agent 的指令"
              />
              <footer>
                <span><MagicWandIcon />实时修改当前行程</span>
                <button
                  type="submit"
                  disabled={!agentInput.trim()
                    || demoAgentState.isPersisting
                    || ["starting", "pausing", "resuming", "stopping", "undoing"].includes(agentStatus)}
                  aria-label="发送给行程 Agent"
                >
                  <PaperPlaneIcon />
                </button>
              </footer>
            </form>
            <small className="agent-safety-note">每次只执行一个可见操作 · 你可随时暂停、拖动或撤回</small>
          </section>
        </aside>
      </section>
    </main>
  );
}

function RouteMap({
  places = defaultTravelPlaces,
  orderedStopIds,
  activeStopId,
  onSelect,
  compact = false,
}) {
  const mapStops = orderedStopIds
    .map((stopId) => places.find((stop) => stop.id === stopId))
    .filter(Boolean);

  return (
    <div className={`route-map ${compact ? "compact" : ""}`}>
      <InteractiveRouteMap
        places={mapStops}
        routeOrder={orderedStopIds}
        activeStopId={activeStopId}
        onSelectStop={onSelect}
        compact={compact}
        className="is-embedded"
        ariaLabel="北京路线交互地图"
      />
    </div>
  );
}

const nearbyDistanceByStopId = {
  1: "0.4 km",
  2: "0.7 km",
  3: "0.9 km",
  4: "1.2 km",
  5: "1.4 km",
  6: "1.6 km",
  7: "1.1 km",
  8: "1.8 km",
};

const nearbySavedStopIds = new Set([1, 4, 5, 7]);

const nearbyFeedFilters = [
  { id: "all", label: "全部", matches: () => true },
  {
    id: "culture",
    label: "人文艺术",
    matches: (stop) => /古建|宫城|中轴线|文化/.test(`${stop.type}${stop.libraryTag}`),
  },
  {
    id: "citywalk",
    label: "城市漫步",
    matches: (stop) => /胡同|街巷|在地/.test(`${stop.type}${stop.libraryTag}`),
  },
  {
    id: "food",
    label: "美食咖啡",
    matches: (stop) => /咖啡|早午餐|湖畔夜色/.test(`${stop.type}${stop.libraryTag}`),
  },
  {
    id: "scenery",
    label: "风景",
    matches: (stop) => /日落|自然|湖畔|夜色/.test(`${stop.type}${stop.libraryTag}`),
  },
];

function NearbyInspirationMap({
  items,
  displayStopId,
  selectedStopId,
  detailStopId,
  showSavedOnly,
  onToggleSaved,
  onPreviewEnd,
  onSelect,
  onCloseDetail,
  onToast,
}) {
  const mapRef = useRef(null);
  const detailRef = useRef(null);
  const displayItem = items.find(({ stop }) => stop.id === displayStopId) ?? items[0];
  const detailItem = items.find(({ stop }) => stop.id === detailStopId) ?? null;
  const mapPlaces = useMemo(() => items.map(({ stop }) => ({
    ...defaultTravelPlaces.find((place) => place.id === stop.id),
    ...stop,
  })), [items]);

  useEffect(() => {
    if (!detailItem) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      detailRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [detailItem?.stop.id]);

  if (!displayItem) {
    return (
      <section className="result-explorer-map is-empty" data-inspiration-map>
        <img src="/assets/beijing-route-map.png" alt="北京附近灵感地图" />
        <div className="result-map-empty">
          <MagnifyingGlassIcon />
          <strong>没有找到匹配的附近灵感</strong>
          <span>换个关键词，或切回“全部”继续查看。</span>
        </div>
      </section>
    );
  }

  return (
    <section
      className="result-explorer-map has-interactive-map"
      data-inspiration-map
      data-selected-stop-id={selectedStopId ?? ""}
      data-detail-open={detailItem ? "true" : "false"}
      onMouseLeave={onPreviewEnd}
    >
      <InteractiveRouteMap
        ref={mapRef}
        places={mapPlaces}
        routeOrder={items.map(({ stop }) => stop.id)}
        activeStopId={displayStopId}
        onSelectStop={onSelect}
        showChrome={false}
        showRoute={false}
        className="is-embedded"
        ariaLabel="北京附近灵感交互地图"
      />

      <div className="result-map-heading">
        <span><DrawingPinIcon />北京 · 附近灵感</span>
        <strong>{items.length} 个地点正在地图中联动</strong>
      </div>

      <div className="result-map-actions" aria-label="地图操作">
        <button
          type="button"
          onClick={() => {
            mapRef.current?.fitRoute();
            onToast("已回到路线全览");
          }}
          aria-label="回到路线全览"
        >
          <PaperPlaneIcon />
        </button>
        {!STATIC_DEMO_MODE && (
          <>
            <button
              type="button"
              onClick={() => {
                mapRef.current?.zoomIn();
                onToast("地图已放大");
              }}
              aria-label="放大地图"
            >
              <PlusIcon />
            </button>
            <button
              type="button"
              onClick={() => {
                mapRef.current?.zoomOut();
                onToast("地图已缩小");
              }}
              aria-label="缩小地图"
            >
              <MinusIcon />
            </button>
          </>
        )}
      </div>

      {detailItem ? (
        <aside
          ref={detailRef}
          id="nearby-place-detail"
          className="nearby-place-detail"
          data-inspiration-popover-stop-id={detailItem.stop.id}
          data-time={detailItem.schedule.time}
          data-distance={detailItem.distance}
          role="dialog"
          aria-modal="false"
          aria-labelledby="nearby-place-detail-title"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCloseDetail();
          }}
        >
          <div className="nearby-place-detail-hero">
            <img src={detailItem.stop.image} alt={`${detailItem.stop.name}地点详情`} />
            <button
              type="button"
              className="nearby-place-detail-close"
              onClick={onCloseDetail}
              aria-label={`关闭${detailItem.stop.name}详情`}
            >
              <Cross2Icon />
            </button>
            <span>附近灵感 · 建议 {detailItem.schedule.time}</span>
          </div>

          <div className="nearby-place-detail-body">
            <header>
              <small>{detailItem.stop.type}</small>
              <h2 id="nearby-place-detail-title">{detailItem.stop.name}</h2>
              <p>{detailItem.stop.note}</p>
            </header>

            <dl className="nearby-place-detail-facts">
              <div>
                <dt><ClockIcon />建议停留</dt>
                <dd>{detailItem.stop.duration}</dd>
              </div>
              <div>
                <dt><BookmarkIcon />预计花费</dt>
                <dd>{detailItem.stop.cost}</dd>
              </div>
              <div>
                <dt><DrawingPinIcon />距你</dt>
                <dd>{detailItem.distance}</dd>
              </div>
            </dl>

            <div className="nearby-place-detail-source">
              <img src={detailItem.stop.libraryAvatar} alt="" />
              <span>
                <small>来自北京在地发现者</small>
                <strong>{detailItem.stop.libraryCreator}</strong>
              </span>
              <em>#{detailItem.stop.libraryTag}</em>
            </div>
          </div>
        </aside>
      ) : null}

      <button
        type="button"
        className="result-map-saved-toggle"
        aria-pressed={showSavedOnly}
        onClick={onToggleSaved}
      >
        <BookmarkIcon />
        <span>只看已收藏</span>
        <i aria-hidden="true"><span /></i>
      </button>
    </section>
  );
}

function PlanResultPage({ scheduleItems, activeStopId, setActiveStopId, onStart, onBack, onToast }) {
  const orderedStopIds = scheduleItems.map((item) => item.stopId);
  const orderedStops = orderedStopIds
    .map((id) => stops.find((stop) => stop.id === id))
    .filter(Boolean);
  const originalStopIds = initialTimelineSlots.map((slot) => slot.stopId);
  const preservedCount = orderedStopIds.filter((id) => originalStopIds.includes(id)).length;
  const addedCount = orderedStopIds.filter((id) => !originalStopIds.includes(id)).length;
  const removedCount = originalStopIds.filter((id) => !orderedStopIds.includes(id)).length;
  const routeChanges = [
    `保留 ${preservedCount} 站`,
    addedCount > 0 ? `新增 ${addedCount} 站` : null,
    removedCount > 0 ? `移除 ${removedCount} 站` : null,
    "顺序已按你的画布更新",
  ].filter(Boolean).join(" · ");
  const active = orderedStops.find((stop) => stop.id === activeStopId) ?? orderedStops[0];
  const activeIndex = orderedStops.findIndex((stop) => stop.id === active.id);
  const routeDuration = scheduleItems.length > 1
    ? Math.max(1, Math.round((timeToMinutes(scheduleItems[scheduleItems.length - 1].time) - timeToMinutes(scheduleItems[0].time)) / 60))
    : 1;

  return (
    <main className="page result-page">
      <section className="result-hero">
        <img src="/assets/beijing-hero-hutong.png" alt="北京胡同与艺文路线封面" />
        <span className="result-hero-overlay" />
        <div className="result-hero-tools">
          <button type="button" onClick={onBack}><ArrowLeftIcon />返回画布</button>
          <div>
            <button type="button" onClick={() => onToast("路线链接已复制")}><Share1Icon />分享</button>
            <button type="button" onClick={() => onToast("路线已收藏")}><BookmarkIcon />收藏</button>
          </div>
        </div>
        <div className="result-hero-copy">
          <small>北京 · 我的路线 · 2026.07.25</small>
          <h1>胡同艺文与中轴线一日</h1>
          <p>{orderedStops.length} 个地点 · 预计 {routeDuration} 小时 · 步行 4.6 公里 · 预算 ¥320</p>
        </div>
      </section>

      <section className="creator-result-strip">
        <img src="/assets/creator-chen.png" alt="陈以欢头像" />
        <div>
          <small>灵感路线</small>
          <strong>陈以欢 · 北京胡同与艺文一日 <CheckCircledIcon /></strong>
          <span>{routeChanges}</span>
        </div>
        <button type="button" onClick={() => onToast("已展开来源与变更说明")}>查看来源</button>
      </section>

      <section className="route-result-workspace">
        <aside className="result-stop-list">
          <div className="result-list-heading">
            <div>
              <span>Day 1</span>
              <strong>地点与时间</strong>
            </div>
            <small>点击与地图联动</small>
          </div>
          <div className="result-list-scroll">
            {orderedStops.map((stop, index) => (
              <button
                type="button"
                key={scheduleItems[index].slotId}
                data-result-stop-id={stop.id}
                data-time={scheduleItems[index].time}
                className={active.id === stop.id ? "active" : ""}
                onClick={() => setActiveStopId(stop.id)}
              >
                <span className="result-index">{index + 1}</span>
                <img src={stop.image} alt="" />
                <span className="result-stop-copy">
                  <small>{scheduleItems[index].time} · {stop.duration}</small>
                  <strong>{stop.name}</strong>
                  <em>{stop.type}</em>
                </span>
                <ChevronRightIcon />
              </button>
            ))}
          </div>
        </aside>
        <section className="result-map-panel">
          <RouteMap
            orderedStopIds={orderedStopIds}
            activeStopId={active.id}
            onSelect={setActiveStopId}
          />
          <div className="map-toolbar">
            <span><DrawingPinIcon />北京 · 东城—西城</span>
            <div>
              <button type="button" onClick={() => onToast("地图已缩小")}><MinusIcon /></button>
              <button type="button" onClick={() => onToast("地图已放大")}><PlusIcon /></button>
              <button type="button" onClick={() => onToast("已回到路线全览")}><ReloadIcon /></button>
            </div>
          </div>
          <article
            className="active-stop-popover"
            data-result-active-popover-stop-id={active.id}
            data-time={scheduleItems[activeIndex].time}
          >
            <img src={active.image} alt={`${active.name}现场`} />
            <div>
              <span>第 {activeIndex + 1} 站 · {scheduleItems[activeIndex].time}</span>
              <h2>{active.name}</h2>
              <p>{active.note}</p>
              <small><LapTimerIcon />{active.travel} · {active.cost}</small>
            </div>
          </article>
        </section>
      </section>

      <section className="result-summary-bar">
        <div>
          <span><CheckCircledIcon />路线已通过基础检查</span>
          <p>预约未冲突 · 动态信息最近核验于 7 月 23 日 · 未知信息会在出发前再次提醒</p>
        </div>
        <button type="button" className="secondary-button" onClick={onBack}><Pencil1Icon />继续编辑</button>
        <button
          type="button"
          className="primary-button"
          data-result-start-journey
          onClick={onStart}
        >
          开始今天的行程
          <ArrowRightIcon />
        </button>
      </section>
    </main>
  );
}

function addMinutes(time, minutesToAdd) {
  const [hours, minutes] = time.split(":").map(Number);
  const total = (hours * 60 + minutes + minutesToAdd) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function NavigatePage({
  scheduleItems,
  places,
  journeyIndex,
  journeyDelay,
  journeyComplete,
  skippedStopIds,
  onCompleteStop,
  onSkip,
  onDelay,
  onBack,
  onToast,
  isRecordingJourney = false,
}) {
  const orderedStopIds = scheduleItems.map((item) => item.stopId);
  const orderedStops = orderedStopIds
    .map((id) => places.find((stop) => stop.id === id))
    .filter(Boolean);
  const activeIndex = Math.min(journeyIndex, Math.max(orderedStops.length - 1, 0));
  const active = orderedStops[activeIndex] ?? orderedStops[0];
  const next = orderedStops[activeIndex + 1];

  if (!active) {
    return null;
  }

  return (
    <main className="page navigate-page">
      <section className="navigate-title-row">
        <div>
          <button type="button" onClick={onBack}><ArrowLeftIcon />返回路线</button>
          <span>Day 1 · {journeyComplete ? "行程已完成" : "行程进行中"} · 最近同步 10:26</span>
        </div>
        <strong>{journeyComplete ? orderedStops.length : activeIndex + 1} / {orderedStops.length} 站</strong>
      </section>
      <section className="navigate-workspace" data-journey-workspace>
        <aside className="journey-rail" data-journey-rail>
          <div className="journey-progress-heading">
            <span>今天的路线</span>
            <strong>胡同艺文与中轴线</strong>
          </div>
          <div className="journey-stop-list">
            {orderedStops.map((stop, index) => (
              <button
                type="button"
                key={scheduleItems[index].slotId}
                data-stop-id={stop.id}
                data-journey-stop-id={stop.id}
                data-time={scheduleItems[index].time}
                className={`${index < activeIndex || journeyComplete ? "done" : ""} ${!journeyComplete && stop.id === active.id ? "active" : ""} ${skippedStopIds.includes(stop.id) ? "skipped" : ""}`}
                onClick={() => onToast(`第 ${index + 1} 站 · ${stop.name}${index < activeIndex ? "已结束" : index === activeIndex ? "正在进行" : "尚未开始"}`)}
              >
                <span>{index < activeIndex || journeyComplete ? <CheckCircledIcon /> : index + 1}</span>
                <img src={stop.image} alt="" />
                <span>
                  <small>{scheduleItems[index].time}</small>
                  <strong>{stop.name}</strong>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <section className="journey-map" data-journey-map>
          <RouteMap
            places={places}
            orderedStopIds={orderedStopIds}
            activeStopId={journeyComplete ? null : active.id}
            onSelect={(stopId) => {
              const stop = orderedStops.find((item) => item.id === stopId);
              const index = orderedStopIds.indexOf(stopId);
              onToast(`地图预览：第 ${index + 1} 站 · ${stop.name}`);
            }}
            compact
          />
          <div className="live-location">
            <PaperPlaneIcon />
            <span>点击地图定位按钮获取当前位置</span>
          </div>
        </section>
        <aside className="journey-control-panel">
          <div className={`now-card ${journeyComplete ? "complete" : ""}`}>
            {journeyComplete ? (
              <div className="journey-complete-state">
                <CheckCircledIcon />
                <span>今日路线已完成</span>
                <h1>这次真实行程，已写回你的路线</h1>
                <p>实际顺序、跳过地点与延误记录都已保留，可以继续补充照片与感受。</p>
              </div>
            ) : (
              <>
                <img src={active.image} alt={`${active.name}现场`} />
                <span>现在 · 第 {activeIndex + 1} 站</span>
                <h1>{active.name}</h1>
                <p>{active.note}</p>
              </>
            )}
            <div>
              <span><ClockIcon />{journeyComplete ? `总延误 ${journeyDelay} 分钟` : `建议停留 ${active.duration}`}</span>
              <span><ReaderIcon />{journeyComplete ? `${orderedStops.length - skippedStopIds.length} 站到访` : active.cost}</span>
            </div>
          </div>
          <div className="next-card">
            <small>{journeyComplete ? "路线记录" : next ? "下一站" : "最后一站"}</small>
            <strong>{journeyComplete ? "生成我的真实路线故事" : next ? next.name : "完成后生成路线故事"}</strong>
            <span>
              {journeyComplete
                ? "把这次真实体验沉淀成下一位旅行者可参考的路线"
                : next
                  ? `${active.travel} · 预计 ${addMinutes(scheduleItems[activeIndex + 1].time, journeyDelay)} 到达${journeyDelay ? ` · 已顺延 ${journeyDelay} 分钟` : ""}`
                  : "路线结束后回写实际到访"}
            </span>
          </div>
          <div className="journey-actions">
            <button type="button" className="navigation-button" onClick={() => onToast(journeyComplete ? "已创建路线故事草稿" : `正在打开到${active.name}的导航`)}>
              <PaperPlaneIcon />
              {journeyComplete ? "生成路线故事" : "开始导航"}
            </button>
            {!journeyComplete ? (
              <>
                <div>
                  <button type="button" onClick={onDelay} disabled={isRecordingJourney}><LapTimerIcon />我晚了{journeyDelay ? ` · ${journeyDelay} 分` : ""}</button>
                  <button type="button" onClick={onSkip} disabled={isRecordingJourney}><ReloadIcon />跳过</button>
                </div>
                <button type="button" className="complete-button" onClick={onCompleteStop} disabled={isRecordingJourney}>
                  <CheckCircledIcon />
                  {isRecordingJourney ? "正在保存…" : next ? "完成本站" : "完成今日路线"}
                </button>
              </>
            ) : null}
          </div>
          <div className="offline-note"><GlobeIcon />当天路线与地址已缓存，可离线查看。</div>
        </aside>
      </section>
    </main>
  );
}

export function App() {
  const [page, setPage] = useState("discover");
  const [routeSearchQuery, setRouteSearchQuery] = useState("");
  const [dashboardSearchQuery, setDashboardSearchQuery] = useState("");
  const [selectedRoute, setSelectedRoute] = useState(routes[0]);
  const [places, setPlaces] = useState(defaultTravelPlaces);
  const [sourceImport, setSourceImport] = useState(null);
  const [tripSession, setTripSession] = useState(null);
  const [timelineSlots, setTimelineSlots] = useState(cloneInitialTimelineSlots);
  const [plannerState, setPlannerState] = useState(createEmptyPlannerState);
  const [hasOpenedCanvas, setHasOpenedCanvas] = useState(false);
  const [plannerSessionId, setPlannerSessionId] = useState(0);
  const [activeStopId, setActiveStopId] = useState(1);
  const [confirmedSchedule, setConfirmedSchedule] = useState(cloneInitialTimelineSlots);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRecordingJourney, setIsRecordingJourney] = useState(false);
  const [journeyIndex, setJourneyIndex] = useState(0);
  const [journeyDelay, setJourneyDelay] = useState(0);
  const [journeyComplete, setJourneyComplete] = useState(false);
  const [skippedStopIds, setSkippedStopIds] = useState([]);
  const [journeyOrigin, setJourneyOrigin] = useState("dashboard");
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  const confirmedStopIds = useMemo(
    () => confirmedSchedule.map((item) => item.stopId),
    [confirmedSchedule],
  );

  const showToast = (message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2400);
  };

  useEffect(() => {
    const savedTripId = window.localStorage.getItem(LAST_TRIP_STORAGE_KEY);
    if (!savedTripId) return undefined;

    let cancelled = false;
    getTrip(savedTripId)
      .then((payload) => {
        if (cancelled) return;
        const restored = buildPlannerStateFromTrip(payload, defaultTravelPlaces);
        if (!restored.timelineSlots.length) return;
        const restoredPlaces = mergeWithDefaultPlaces(restored.places);
        const firstStopId = restored.timelineSlots[0].stopId;
        setPlaces(restoredPlaces);
        setTimelineSlots(restored.timelineSlots);
        setPlannerState(restored.plannerState ?? createEmptyPlannerState());
        setConfirmedSchedule(restored.timelineSlots);
        setTripSession(restored.trip);
        setActiveStopId(firstStopId);
        setPlannerSessionId((current) => current + 1);
        if (payload?.source?.platform === "XIAOHONGSHU") {
          setSourceImport({
            importId: payload.sourceImportId,
            source: payload.source,
            extraction: {
              title: payload.title,
              city: payload.city,
              summary: "已从后端恢复这条由用户主动交接的小红书灵感路线。",
              stops: restored.places,
            },
            warnings: [],
          });
        }
      })
      .catch((error) => {
        if (!cancelled && error?.status === 404) {
          window.localStorage.removeItem(LAST_TRIP_STORAGE_KEY);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const navigate = (nextPage) => {
    const resolvedPage = nextPage === "plan" ? "dashboard" : nextPage;
    window.clearTimeout(toastTimer.current);
    setToast("");
    if (resolvedPage === "canvas") setHasOpenedCanvas(true);
    setPage(resolvedPage);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  const clearPersistedTrip = () => {
    setTripSession(null);
    setPlannerState(createEmptyPlannerState());
    window.localStorage.removeItem(LAST_TRIP_STORAGE_KEY);
  };

  const handleXiaohongshuImported = (importRecord) => {
    const plannerState = buildPlannerStateFromImport(importRecord, defaultTravelPlaces);
    const nextPlaces = mergeWithDefaultPlaces(plannerState.places);
    const firstStopId = plannerState.timelineSlots[0]?.stopId ?? null;
    setPlaces(nextPlaces);
    setTimelineSlots(plannerState.timelineSlots);
    setPlannerState(createEmptyPlannerState());
    setConfirmedSchedule(plannerState.timelineSlots);
    setSourceImport(importRecord);
    setSelectedRoute(plannerState.selectedRoute);
    setActiveStopId(firstStopId);
    setJourneyIndex(0);
    setJourneyDelay(0);
    setJourneyComplete(false);
    setSkippedStopIds([]);
    clearPersistedTrip();
    setPlannerSessionId((current) => current + 1);
    navigate("canvas");
    window.setTimeout(() => {
      showToast(`已把 ${plannerState.timelineSlots.length} 个北京演示地点放入画布`);
    }, 0);
  };

  const applyCanonicalTrip = (payload, { updateConfirmed = false } = {}) => {
    const restored = buildPlannerStateFromTrip(payload, places);
    const restoredPlaces = mergeWithDefaultPlaces(restored.places);
    setPlaces(restoredPlaces);
    setTimelineSlots(restored.timelineSlots);
    setPlannerState(restored.plannerState ?? createEmptyPlannerState());
    setTripSession(restored.trip);
    if (updateConfirmed) setConfirmedSchedule(restored.timelineSlots);
    window.localStorage.setItem(LAST_TRIP_STORAGE_KEY, restored.trip.tripId);
    return restored.trip;
  };

  const persistPlannerSnapshot = async (
    draftSlots,
    nextPlannerState = plannerState,
    { status = null, updateConfirmed = false } = {},
  ) => {
    const snapshot = sortTimelineSlots(draftSlots).map((slot) => ({ ...slot }));
    if (!snapshot.length) throw new Error("至少需要一个行程节点");
    const normalizedPlannerState = {
      constraints: Array.isArray(nextPlannerState?.constraints)
        ? nextPlannerState.constraints.map((constraint) => ({ ...constraint }))
        : [],
      transportModeOverrides: {
        ...(nextPlannerState?.transportModeOverrides ?? {}),
      },
    };
    const persistedStatus = status
      ?? (tripSession?.status === "CONFIRMED" ? "CONFIRMED" : "DRAFT");
    const submittedTrip = buildConfirmedTripPayload({
      scheduleItems: snapshot,
      places,
      sourceImport,
      route: selectedRoute,
      title: sourceImport?.extraction?.title ?? selectedRoute?.title,
      city: "北京",
      status: persistedStatus,
      plannerState: normalizedPlannerState,
    });

    let receipt;
    if (tripSession?.tripId && tripSession?.revisionId && !tripSession?.localOnly) {
      receipt = await saveTripSchedule({
        tripId: tripSession.tripId,
        revisionId: tripSession.revisionId,
        stops: submittedTrip.stops,
        plannerState: normalizedPlannerState,
        ...(status ? { status } : {}),
      });
    } else {
      receipt = await createConfirmedTrip(submittedTrip);
    }

    const canonicalPayload = mergeTripReceiptWithSubmittedSnapshot(receipt, submittedTrip);
    return applyCanonicalTrip(canonicalPayload, { updateConfirmed });
  };

  const ensureAgentDraft = (draftSlots, nextPlannerState) => (
    persistPlannerSnapshot(draftSlots, nextPlannerState, {
      status: manualScheduleStatus(tripSession?.status),
    })
  );

  const persistManualPlan = (draftSlots, nextPlannerState) => (
    persistPlannerSnapshot(draftSlots, nextPlannerState, {
      status: manualScheduleStatus(tripSession?.status),
    })
  );

  const handleAgentTripCommitted = (trip) => {
    if (!trip?.stops?.length) return;
    applyCanonicalTrip(trip);
  };

  const confirmPlan = async (draftSlots, nextPlannerState = plannerState) => {
    if (isConfirming) return;
    const snapshot = sortTimelineSlots(draftSlots).map((slot) => ({ ...slot }));
    if (snapshot.length === 0) {
      showToast("至少安排一个地点后再确认行程");
      return;
    }

    setIsConfirming(true);
    showToast("正在保存行程，请稍候…");
    const openConfirmedDashboard = (session) => {
      setConfirmedSchedule(snapshot);
      setTripSession(session);
      setPlannerState({
        constraints: Array.isArray(nextPlannerState?.constraints)
          ? nextPlannerState.constraints.map((constraint) => ({ ...constraint }))
          : [],
        transportModeOverrides: {
          ...(nextPlannerState?.transportModeOverrides ?? {}),
        },
      });
      setActiveStopId(snapshot[0].stopId);
      setJourneyIndex(0);
      setJourneyDelay(0);
      setJourneyComplete(false);
      setSkippedStopIds([]);
      navigate("dashboard");
    };
    try {
      if (isLoopbackPreview()) {
        openConfirmedDashboard(createLocalTripSession());
        window.setTimeout(() => {
          showToast("本地预览模式：已生成演示行程");
        }, 0);
        return;
      }

      const receipt = await persistPlannerSnapshot(snapshot, nextPlannerState, {
        status: "CONFIRMED",
        updateConfirmed: true,
      });
      openConfirmedDashboard(receipt);
      window.setTimeout(() => {
        showToast(
          receipt.revision
            ? `行程已保存到后端 · 版本 ${receipt.revision}`
            : "行程已保存到后端",
        );
      }, 0);
    } catch (error) {
      if (error?.status === 409 && tripSession?.tripId && !tripSession?.localOnly) {
        try {
          const latestPayload = await getTrip(tripSession.tripId);
          const latest = buildPlannerStateFromTrip(latestPayload, defaultTravelPlaces);
          setPlaces(mergeWithDefaultPlaces(latest.places));
          setTimelineSlots(latest.timelineSlots);
          setConfirmedSchedule(latest.timelineSlots);
          setTripSession(latest.trip);
          setPlannerSessionId((current) => current + 1);
          showToast("行程版本已更新，已载入后端最新版本，请确认后再保存");
        } catch {
          showToast("行程版本冲突，且暂时无法读取最新版本");
        }
      } else if (isUnavailableTripServiceError(error)) {
        openConfirmedDashboard(createLocalTripSession());
        window.setTimeout(() => {
          showToast("后端暂不可用，已生成本地演示行程");
        }, 0);
      } else {
        showToast(error?.message ?? "行程保存失败，请检查后端后重试");
      }
    } finally {
      setIsConfirming(false);
    }
  };

  const startJourney = async (origin = "dashboard") => {
    if (!tripSession?.tripId) {
      navigate("canvas");
      window.setTimeout(() => showToast("请先确认行程，保存后即可进入实时行程"), 0);
      return;
    }
    if (isRecordingJourney) return;
    setIsRecordingJourney(true);
    let syncWarning = "";
    try {
      if (!tripSession.localOnly) {
        await recordExecutionEvent(tripSession.tripId, {
          type: "JOURNEY_STARTED",
          occurredAt: new Date().toISOString(),
          payload: { origin },
        });
      }
    } catch (error) {
      syncWarning = error?.message ?? "开始记录暂时未同步到后端";
    } finally {
      setIsRecordingJourney(false);
    }
    setJourneyOrigin(origin);
    setJourneyIndex(0);
    setJourneyDelay(0);
    setJourneyComplete(false);
    setSkippedStopIds([]);
    setActiveStopId(confirmedStopIds[0]);
    navigate("navigate");
    if (syncWarning) {
      window.setTimeout(() => showToast(`已进入行程；${syncWarning}`), 0);
    }
  };

  const advanceJourney = async (skipped = false) => {
    if (isRecordingJourney) return;
    const currentStopId = confirmedStopIds[journeyIndex];
    const currentStop = places.find((stop) => stop.id === currentStopId);
    if (!currentStop) return;
    setIsRecordingJourney(true);
    let syncWarning = "";
    try {
      if (tripSession?.tripId && !tripSession?.localOnly) {
        await recordExecutionEvent(tripSession.tripId, {
          type: skipped ? "STOP_SKIPPED" : "STOP_COMPLETED",
          clientStopId: String(currentStopId),
          occurredAt: new Date().toISOString(),
          payload: { journeyIndex },
        });
        if (journeyIndex >= confirmedStopIds.length - 1) {
          await recordExecutionEvent(tripSession.tripId, {
            type: "JOURNEY_COMPLETED",
            occurredAt: new Date().toISOString(),
            payload: {
              skippedStopIds: skipped
                ? [...new Set([...skippedStopIds, currentStopId])].map(String)
                : skippedStopIds.map(String),
              totalDelayMinutes: journeyDelay,
            },
          });
        }
      }
    } catch (error) {
      syncWarning = error?.message ?? "到访记录暂时未同步到后端";
    } finally {
      setIsRecordingJourney(false);
    }
    if (skipped) {
      setSkippedStopIds((current) => current.includes(currentStopId) ? current : [...current, currentStopId]);
    }
    if (journeyIndex < confirmedStopIds.length - 1) {
      const nextIndex = journeyIndex + 1;
      const nextStop = places.find((stop) => stop.id === confirmedStopIds[nextIndex]);
      setJourneyIndex(nextIndex);
      setActiveStopId(nextStop.id);
      showToast(
        syncWarning
          ? `${currentStop.name}已在本机更新；${syncWarning}`
          : skipped
            ? `${currentStop.name}已跳过，下一站是${nextStop.name}`
            : `${currentStop.name}已完成，下一站是${nextStop.name}`,
      );
    } else {
      setJourneyComplete(true);
      showToast(
        syncWarning
          ? `今日路线已完成；${syncWarning}`
          : "今日路线已完成，真实到访记录已经保存",
      );
    }
  };

  const recordJourneyDelay = async () => {
    if (isRecordingJourney) return;
    setIsRecordingJourney(true);
    let syncWarning = "";
    try {
      if (tripSession?.tripId && !tripSession?.localOnly) {
        await recordExecutionEvent(tripSession.tripId, {
          type: "DELAY_RECORDED",
          occurredAt: new Date().toISOString(),
          payload: { delayMinutes: 20 },
        });
      }
    } catch (error) {
      syncWarning = error?.message ?? "延误记录暂时未同步到后端";
    } finally {
      setIsRecordingJourney(false);
    }
    setJourneyDelay((current) => current + 20);
    showToast(
      syncWarning
        ? `已在本机顺延 20 分钟；${syncWarning}`
        : "已记录延误 20 分钟，后续到达时间已顺延",
    );
  };

  return (
    <div className="app-shell" data-page={page}>
      <AppChrome
        page={page}
        onNavigate={navigate}
        onToast={showToast}
        searchQuery={page === "dashboard" ? dashboardSearchQuery : routeSearchQuery}
        onSearchQueryChange={page === "dashboard" ? setDashboardSearchQuery : setRouteSearchQuery}
        onSearchSubmit={() => {
          if (page === "dashboard") {
            showToast(
              dashboardSearchQuery.trim()
                ? `已筛选当前行程中的「${dashboardSearchQuery.trim()}」`
                : "已显示当前行程的全部地点",
            );
            return;
          }
          navigate("discover");
          if (routeSearchQuery.trim()) {
            window.setTimeout(() => showToast(`正在查找与「${routeSearchQuery.trim()}」相关的路线`), 0);
          }
        }}
      />
      {page === "dashboard" ? (
        <DashboardPage
          query={dashboardSearchQuery}
          onSearchQueryChange={setDashboardSearchQuery}
          onSearchSubmit={() => {
            showToast(
              dashboardSearchQuery.trim()
                ? `已筛选当前行程中的「${dashboardSearchQuery.trim()}」`
                : "已显示当前行程的全部地点",
            );
          }}
          onNavigate={navigate}
          onStartJourney={() => startJourney("dashboard")}
          onToast={showToast}
          confirmedSchedule={confirmedSchedule}
          places={places}
          tripSession={tripSession}
          sourceImport={sourceImport}
        />
      ) : null}
      {page === "discover" ? (
        <DiscoverPage
          query={routeSearchQuery}
          onImported={handleXiaohongshuImported}
          onStartPlanning={(route) => {
            setSelectedRoute(route);
            navigate("route-detail");
          }}
          onToast={showToast}
        />
      ) : null}
      {page === "inspiration" ? (
        <NearbyInspirationPage onToast={showToast} />
      ) : null}
      {page === "route-detail" ? (
        <RouteDetailPage
          route={selectedRoute}
          onBack={() => navigate("discover")}
          onUsePlan={() => {
            const initialSchedule = cloneInitialTimelineSlots();
            setPlaces(defaultTravelPlaces);
            setSourceImport(null);
            clearPersistedTrip();
            setTimelineSlots(initialSchedule);
            setPlannerState(createEmptyPlannerState());
            setConfirmedSchedule(initialSchedule);
            setActiveStopId(initialSchedule[0].stopId);
            setPlannerSessionId((current) => current + 1);
            navigate("canvas");
          }}
          onToast={showToast}
        />
      ) : null}
      {page === "canvas" || hasOpenedCanvas ? (
        <TimelinePlannerPage
          key={plannerSessionId}
          timelineSlots={timelineSlots}
          setTimelineSlots={setTimelineSlots}
          places={places}
          tripSession={tripSession}
          plannerState={plannerState}
          onConfirm={confirmPlan}
          onEnsureAgentDraft={ensureAgentDraft}
          onAgentTripCommitted={handleAgentTripCommitted}
          onPersistManualPlan={persistManualPlan}
          onToast={showToast}
          isConfirming={isConfirming}
          sourceImport={sourceImport}
          isVisible={page === "canvas"}
        />
      ) : null}
      {page === "navigate" ? (
        <NavigatePage
          scheduleItems={confirmedSchedule}
          places={places}
          journeyIndex={journeyIndex}
          journeyDelay={journeyDelay}
          journeyComplete={journeyComplete}
          skippedStopIds={skippedStopIds}
          onCompleteStop={() => advanceJourney(false)}
          onSkip={() => advanceJourney(true)}
          onDelay={recordJourneyDelay}
          onBack={() => navigate(journeyOrigin)}
          onToast={showToast}
          isRecordingJourney={isRecordingJourney}
        />
      ) : null}
      {toast ? <div className="toast" role="status"><CheckCircledIcon />{toast}</div> : null}
    </div>
  );
}
