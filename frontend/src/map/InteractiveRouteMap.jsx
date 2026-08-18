import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clampMapZoom,
  fitMapViewport,
  lngLatToWorld,
  normalizeMapPlaces,
  projectToScreen,
  screenToLngLat,
  TILE_SIZE,
  worldToLngLat,
} from "./mapModel.js";
import { calculateVisibleRasterTiles } from "./mapTileModel.js";
import "./InteractiveRouteMap.css";
import { assetUrl } from "../assetUrl.js";

const BAIDU_API_TIMEOUT_MS = 15_000;
const BAIDU_RUNTIME_HEALTH_DELAY_MS = 2_500;
const BAIDU_SURFACE_READY_TIMEOUT_MS = 12_000;
const BAIDU_SURFACE_PAINT_DELAY_MS = 300;
const DEFAULT_RASTER_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_RASTER_ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright";
const STATIC_DEMO_MODE = typeof __STATIC_DEMO__ !== "undefined" && __STATIC_DEMO__;
const baiduApiPromises = new Map();
const baiduRouteGeometryCache = new Map();
const DEMO_BAIDU_ANCHORS = Object.freeze({
  雍和宫: {
    query: "北京市东城区雍和宫",
    lng: 116.42370918,
    lat: 39.953377859,
  },
  五道营胡同: {
    query: "北京市东城区五道营胡同",
    lng: 116.415124973,
    lat: 39.954949461,
  },
  国子监街: {
    query: "北京市东城区国子监街",
    lng: 116.418891837,
    lat: 39.951771858,
  },
  东四艺文街区: {
    query: "北京市东城区王府井大街1号 嘉德艺术中心",
    lng: 116.416619483,
    lat: 39.92988923,
  },
  景山公园: {
    query: "北京市西城区景山西街44号 景山公园",
    lng: 116.402818007,
    lat: 39.93227005,
  },
  什刹海: {
    query: "北京市西城区什刹海风景区",
    lng: 116.397197669,
    lat: 39.94223553,
  },
  故宫博物院: {
    query: "北京市东城区景山前街4号 故宫博物院",
    lng: 116.403414,
    lat: 39.924091,
  },
  钟鼓楼胡同: {
    query: "北京市东城区钟楼湾胡同临字9号 北京钟鼓楼",
    lng: 116.399153,
    lat: 39.946598,
  },
});

function demoBaiduAnchorForPlace(place) {
  const name = String(place?.name ?? "");
  const demoEntry = Object.entries(DEMO_BAIDU_ANCHORS)
    .find(([knownName]) => name.includes(knownName));
  return demoEntry?.[1] ?? null;
}

function geocodeQueryForPlace(place) {
  if (place?.geocodeQuery) return place.geocodeQuery;
  const demoAnchor = demoBaiduAnchorForPlace(place);
  return demoAnchor?.query || place?.address || String(place?.name ?? "");
}

function routeStrokeWeightForZoom(zoom, compact) {
  if (zoom <= 13) return 1;
  if (zoom <= 15) return 2;
  if (zoom <= 17) return 3;
  return compact ? 3 : 4;
}

function markerVisualForZoom(zoom, compact, active) {
  const base = zoom <= 12
    ? compact ? 12 : 16
    : zoom <= 14
      ? compact ? 14 : 20
      : zoom <= 16
        ? compact ? 17 : 23
        : compact ? 20 : 26;
  const diameter = base + (active ? 4 : 0);
  return {
    diameter,
    borderWidth: active ? 3 : 2,
    fontSize: Math.max(11, Math.min(12, diameter - 11)),
  };
}

function escapeMapHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function routeGeometryCacheKey(mode, start, end) {
  return [
    mode,
    start.lng.toFixed(6),
    start.lat.toFixed(6),
    end.lng.toFixed(6),
    end.lat.toFixed(6),
  ].join(":");
}

const DEMO_ROADS = [
  {
    id: "andingle",
    kind: "major",
    points: [
      { lat: 39.954, lng: 116.373 },
      { lat: 39.948, lng: 116.397 },
      { lat: 39.941, lng: 116.426 },
      { lat: 39.931, lng: 116.446 },
    ],
  },
  {
    id: "di-an-men",
    kind: "major",
    points: [
      { lat: 39.961, lng: 116.404 },
      { lat: 39.943, lng: 116.403 },
      { lat: 39.923, lng: 116.401 },
      { lat: 39.897, lng: 116.399 },
    ],
  },
  {
    id: "gulou",
    kind: "street",
    points: [
      { lat: 39.943, lng: 116.376 },
      { lat: 39.942, lng: 116.395 },
      { lat: 39.945, lng: 116.419 },
      { lat: 39.94, lng: 116.443 },
    ],
  },
  {
    id: "dongsi",
    kind: "street",
    points: [
      { lat: 39.956, lng: 116.426 },
      { lat: 39.938, lng: 116.424 },
      { lat: 39.916, lng: 116.425 },
      { lat: 39.898, lng: 116.421 },
    ],
  },
  {
    id: "jingshan",
    kind: "street",
    points: [
      { lat: 39.928, lng: 116.371 },
      { lat: 39.925, lng: 116.397 },
      { lat: 39.927, lng: 116.423 },
      { lat: 39.924, lng: 116.448 },
    ],
  },
];

const DEMO_WATER = [
  [
    { lat: 39.948, lng: 116.381 },
    { lat: 39.945, lng: 116.387 },
    { lat: 39.938, lng: 116.389 },
    { lat: 39.929, lng: 116.386 },
    { lat: 39.932, lng: 116.379 },
    { lat: 39.941, lng: 116.377 },
  ],
];

const DEMO_LABELS = [
  { id: "dongcheng", name: "东城区", lat: 39.92, lng: 116.425 },
  { id: "shichahai", name: "什刹海", lat: 39.938, lng: 116.381 },
  { id: "gulou", name: "钟鼓楼", lat: 39.946, lng: 116.396 },
  { id: "jingshan", name: "景山", lat: 39.925, lng: 116.397 },
];
const STATIC_DEMO_PLACE_POSITIONS = Object.freeze({
  雍和宫: { left: 38, top: 49 },
  五道营胡同: { left: 41, top: 47 },
  北新桥胡同早餐: { left: 40, top: 44 },
  国子监街: { left: 39, top: 54 },
  东四艺文街区: { left: 44, top: 56 },
  景山公园: { left: 35, top: 59 },
  景山西街红门机位: { left: 36, top: 60 },
  什刹海: { left: 32, top: 55 },
  故宫博物院: { left: 37, top: 61 },
  钟鼓楼胡同: { left: 33, top: 49 },
  南锣鼓巷: { left: 35, top: 52 },
  "798 艺术区": { left: 48, top: 53 },
});

function localRoutePointsForGeometry(projectedPlaces, routeGeometry) {
  if (projectedPlaces.length < 2) return "";
  if (routeGeometry !== "street-grid") {
    return projectedPlaces.map(({ screen }) => `${screen.x},${screen.y}`).join(" ");
  }

  const points = [];
  projectedPlaces.forEach(({ screen }, index) => {
    if (index === 0) {
      points.push(screen);
      return;
    }

    const previous = projectedPlaces[index - 1].screen;
    const horizontalBias = index % 2 === 0 ? 0.44 : 0.56;
    const bendX = previous.x + (screen.x - previous.x) * horizontalBias;
    points.push(
      { x: bendX, y: previous.y },
      { x: bendX, y: screen.y },
      screen,
    );
  });

  return points.map(({ x, y }) => `${x},${y}`).join(" ");
}

function staticDemoPositionForPlace(place) {
  const name = String(place?.name ?? "");
  const matchedEntry = Object.entries(STATIC_DEMO_PLACE_POSITIONS)
    .find(([knownName]) => name.includes(knownName));
  return matchedEntry?.[1] ?? null;
}

function staticDemoScreenForPlace(place, size, fallbackScreen) {
  const fixedPosition = staticDemoPositionForPlace(place);
  const left = Number.parseFloat(fixedPosition?.left ?? place?.position?.left);
  const top = Number.parseFloat(fixedPosition?.top ?? place?.position?.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return fallbackScreen;

  return {
    x: (size.width * Math.min(100, Math.max(0, left))) / 100,
    y: (size.height * Math.min(100, Math.max(0, top))) / 100,
  };
}

const Icon = ({ children, size = 18 }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

const LocateIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Icon>
);

const FitIcon = () => (
  <Icon>
    <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
    <path d="M3 8l5-5M16 3l5 5M21 16l-5 5M8 21l-5-5" />
  </Icon>
);

const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

const MinusIcon = () => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
);

function loadBaiduMapApi(ak) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("百度地图只能在浏览器中加载"));
  }
  if (window.BMapGL?.Map) return Promise.resolve(window.BMapGL);
  if (!ak) return Promise.reject(new Error("未配置百度地图 AK"));
  if (baiduApiPromises.has(ak)) return baiduApiPromises.get(ak);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    let probeTimer = null;
    const originalWrite = document.write;
    const originalWriteln = document.writeln;

    const restoreDocumentWriter = () => {
      document.write = originalWrite;
      document.writeln = originalWriteln;
    };

    const appendProviderMarkup = (...chunks) => {
      const template = document.createElement("template");
      template.innerHTML = chunks.join("");
      [...template.content.children].forEach((node) => {
        const tagName = node.tagName?.toLowerCase();
        if (tagName === "script" && node.src) {
          const childScript = document.createElement("script");
          childScript.src = node.src;
          childScript.async = false;
          childScript.referrerPolicy = "strict-origin-when-cross-origin";
          childScript.onerror = () => finish(new Error("百度地图运行脚本加载失败"));
          document.head.appendChild(childScript);
          return;
        }
        if (tagName === "link" && node.href) {
          const stylesheet = document.createElement("link");
          stylesheet.rel = node.rel || "stylesheet";
          stylesheet.href = node.href;
          document.head.appendChild(stylesheet);
        }
      });
    };

    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (probeTimer !== null) window.clearInterval(probeTimer);

      if (error) {
        restoreDocumentWriter();
        reject(error);
      } else if (window.BMapGL?.Map) {
        resolve(window.BMapGL);
      } else {
        restoreDocumentWriter();
        reject(new Error("百度地图脚本已返回，但 BMapGL 不可用"));
      }
    };

    const timeout = window.setTimeout(
      () => finish(new Error("百度地图加载超时")),
      BAIDU_API_TIMEOUT_MS,
    );

    document.write = appendProviderMarkup;
    document.writeln = appendProviderMarkup;
    probeTimer = window.setInterval(() => {
      if (window.BMapGL?.Map) finish();
    }, 50);

    script.async = true;
    script.dataset.jiluBaiduMap = "true";
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.src = `https://api.map.baidu.com/api?type=webgl&v=1.0&ak=${encodeURIComponent(ak)}`;
    script.onerror = () => finish(new Error("百度地图脚本加载失败"));
    document.head.appendChild(script);
  }).catch((error) => {
    baiduApiPromises.delete(ak);
    throw error;
  });

  baiduApiPromises.set(ak, promise);
  return promise;
}

function browserGeolocation() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("当前浏览器不支持定位"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => resolve({
        lat: coords.latitude,
        lng: coords.longitude,
        accuracy: coords.accuracy,
        timestamp,
        source: "BROWSER_GEOLOCATION",
        coordSystem: "WGS84",
      }),
      (error) => {
        const messages = {
          1: "定位权限被拒绝，请在浏览器设置中允许定位",
          2: "当前无法获取位置信息",
          3: "定位超时，请稍后重试",
        };
        reject(new Error(messages[error.code] ?? "定位失败"));
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 30_000,
      },
    );
  });
}

function baiduGeolocation(BMapGL) {
  return new Promise((resolve, reject) => {
    if (!BMapGL?.Geolocation) {
      reject(new Error("百度定位服务当前不可用"));
      return;
    }

    const geolocation = new BMapGL.Geolocation();
    geolocation.getCurrentPosition(function handleBaiduPosition(result) {
      const status = typeof this.getStatus === "function" ? this.getStatus() : null;
      const successStatus = window.BMAP_STATUS_SUCCESS ?? 0;
      if (status === successStatus && result?.point) {
        resolve({
          lat: result.point.lat,
          lng: result.point.lng,
          accuracy: result.accuracy ?? null,
          timestamp: Date.now(),
          source: "BAIDU_GEOLOCATION",
          coordSystem: "BD09",
        });
        return;
      }
      reject(new Error(status === 6 ? "定位权限被拒绝" : `百度定位失败${status === null ? "" : `（状态 ${status}）`}`));
    }, {
      enableHighAccuracy: true,
      maximumAge: 30_000,
    });
  });
}

function useElementSize(elementRef) {
  const [size, setSize] = useState({ width: 720, height: 420 });

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;

    const measure = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        setSize({ width: bounds.width, height: bounds.height });
      }
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [elementRef]);

  return size;
}

function pointsAttribute(points, viewport) {
  return points
    .map((point) => projectToScreen(point, viewport))
    .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

function buildRasterTileUrl(template, tile) {
  return template
    .replaceAll("{z}", String(tile.z))
    .replaceAll("{x}", String(tile.x))
    .replaceAll("{y}", String(tile.y));
}

function DetailedRasterTileLayer({
  viewport,
  width,
  height,
  tileUrlTemplate,
  onCoverageChange,
}) {
  const tileViewport = useMemo(() => calculateVisibleRasterTiles({
    center: lngLatToWorld(viewport.center),
    zoom: viewport.zoom,
    width,
    height,
    minTileZoom: 3,
    maxTileZoom: 19,
  }), [
    height,
    viewport.center.lat,
    viewport.center.lng,
    viewport.zoom,
    width,
  ]);
  const tileSignature = tileViewport.tiles.map((tile) => tile.key).join("|");
  const [coverage, setCoverage] = useState({
    signature: "",
    loaded: [],
    settled: [],
  });

  useEffect(() => {
    setCoverage({ signature: tileSignature, loaded: [], settled: [] });
    onCoverageChange(false);
  }, [onCoverageChange, tileSignature]);

  const settleTile = useCallback((tileKey, loaded) => {
    setCoverage((current) => {
      const loadedKeys = new Set(
        current.signature === tileSignature ? current.loaded : [],
      );
      const settledKeys = new Set(
        current.signature === tileSignature ? current.settled : [],
      );
      if (loaded) loadedKeys.add(tileKey);
      settledKeys.add(tileKey);
      return {
        signature: tileSignature,
        loaded: [...loadedKeys],
        settled: [...settledKeys],
      };
    });
  }, [tileSignature]);

  useEffect(() => {
    const matchesCurrentTiles = coverage.signature === tileSignature;
    const allTilesSettled = tileViewport.tiles.length > 0
      && coverage.settled.length === tileViewport.tiles.length;
    onCoverageChange(
      matchesCurrentTiles
      && allTilesSettled
      && coverage.loaded.length > 0,
    );
  }, [
    coverage.loaded.length,
    coverage.settled.length,
    coverage.signature,
    onCoverageChange,
    tileSignature,
    tileViewport.tiles.length,
  ]);

  if (!tileUrlTemplate) return null;

  return (
    <div
      className="jilu-local-map__tile-layer"
      data-map-tile-layer
      data-tile-zoom={tileViewport.tileZoom}
      aria-hidden="true"
    >
      {tileViewport.tiles.map((tile) => (
        <img
          key={tile.key}
          className="jilu-local-map__tile"
          src={buildRasterTileUrl(tileUrlTemplate, tile)}
          alt=""
          draggable="false"
          decoding="async"
          referrerPolicy="strict-origin-when-cross-origin"
          style={{
            left: Math.floor(tile.left),
            top: Math.floor(tile.top),
            width: Math.ceil(tile.size) + 1,
            height: Math.ceil(tile.size) + 1,
          }}
          onLoad={() => settleTile(tile.key, true)}
          onError={() => settleTile(tile.key, false)}
        />
      ))}
    </div>
  );
}

const LocalMapSurface = forwardRef(function LocalMapSurface({
  places,
  activeStopId,
  onSelectStop,
  currentLocation,
  isLoadingBaidu,
  rasterTileUrlTemplate,
  baiduStaticAk,
  showRoute,
  routeGeometry,
}, ref) {
  const surfaceRef = useRef(null);
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [hasDetailedTiles, setHasDetailedTiles] = useState(false);
  const handleTileCoverageChange = useCallback((isReady) => {
    setHasDetailedTiles(isReady);
  }, []);
  const size = useElementSize(surfaceRef);
  const [viewport, setViewport] = useState(() => ({
    center: { lat: 39.925, lng: 116.404 },
    zoom: 13,
  }));
  const patternId = useId().replaceAll(":", "");
  const baiduStaticImageUrl = baiduStaticAk && size.width > 0 && size.height > 0
    ? `https://api.map.baidu.com/staticimage/v2?ak=${encodeURIComponent(baiduStaticAk)}&center=${encodeURIComponent(`${viewport.center.lng},${viewport.center.lat}`)}&width=${Math.min(1024, Math.max(320, Math.round(size.width)))}&height=${Math.min(1024, Math.max(240, Math.round(size.height)))}&zoom=${Math.round(clampMapZoom(viewport.zoom))}&copyright=1`
    : "";

  const fitRoute = useCallback(() => {
    const points = places.map(({ lat, lng }) => ({ lat, lng }));
    if (currentLocation) points.push(currentLocation);
    const fitted = fitMapViewport(points, size.width, size.height, 72);
    setViewport(fitted);
    return fitted;
  }, [currentLocation, places, size.height, size.width]);

  useEffect(() => {
    fitRoute();
  }, [fitRoute]);

  const zoomBy = useCallback((amount) => {
    setViewport((current) => ({
      ...current,
      zoom: clampMapZoom(current.zoom + amount),
    }));
  }, []);

  useImperativeHandle(ref, () => ({
    fitRoute,
    zoomIn: () => zoomBy(1),
    zoomOut: () => zoomBy(-1),
  }), [fitRoute, zoomBy]);

  const fullViewport = {
    ...viewport,
    width: size.width,
    height: size.height,
  };

  const projectedPlaces = places.map((place) => {
    const geographicScreen = projectToScreen(place, fullViewport);
    return {
      place,
      screen: STATIC_DEMO_MODE
        ? staticDemoScreenForPlace(place, size, geographicScreen)
        : geographicScreen,
    };
  });
  const routePoints = showRoute
    ? localRoutePointsForGeometry(projectedPlaces, routeGeometry)
    : "";
  const activePlace = places.find((place) => String(place.id) === String(activeStopId));
  const activeProjectedPlace = projectedPlaces.find(
    ({ place }) => String(place.id) === String(activeStopId),
  );
  const projectedCurrentLocation = currentLocation
    ? projectToScreen(currentLocation, fullViewport)
    : null;

  const handlePointerDown = (event) => {
    if (STATIC_DEMO_MODE) return;
    if (
      event.button !== 0
      || event.target.closest("[data-map-marker], [data-map-interactive-control]")
    ) return;
    const startWorld = lngLatToWorld(viewport.center);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWorld,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (event) => {
    if (STATIC_DEMO_MODE) return;
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const scale = TILE_SIZE * 2 ** viewport.zoom;
    const nextWorld = {
      x: drag.startWorld.x - (event.clientX - drag.startX) / scale,
      y: drag.startWorld.y - (event.clientY - drag.startY) / scale,
    };
    setViewport((current) => ({ ...current, center: worldToLngLat(nextWorld) }));
  };

  const finishPointer = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event) => {
    if (STATIC_DEMO_MODE) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const geographicCursor = screenToLngLat(cursor, fullViewport);
    const nextZoom = clampMapZoom(viewport.zoom + (event.deltaY < 0 ? 0.5 : -0.5));
    const cursorWorld = lngLatToWorld(geographicCursor);
    const nextScale = TILE_SIZE * 2 ** nextZoom;
    const nextCenterWorld = {
      x: cursorWorld.x - (cursor.x - size.width / 2) / nextScale,
      y: cursorWorld.y - (cursor.y - size.height / 2) / nextScale,
    };
    setViewport({ center: worldToLngLat(nextCenterWorld), zoom: nextZoom });
  };

  const handleKeyDown = (event) => {
    if (STATIC_DEMO_MODE) return;
    const panPixels = event.shiftKey ? 120 : 48;
    const delta = {
      ArrowLeft: { x: -panPixels, y: 0 },
      ArrowRight: { x: panPixels, y: 0 },
      ArrowUp: { x: 0, y: -panPixels },
      ArrowDown: { x: 0, y: panPixels },
    }[event.key];

    if (delta) {
      event.preventDefault();
      const centerWorld = lngLatToWorld(viewport.center);
      const scale = TILE_SIZE * 2 ** viewport.zoom;
      setViewport((current) => ({
        ...current,
        center: worldToLngLat({
          x: centerWorld.x + delta.x / scale,
          y: centerWorld.y + delta.y / scale,
        }),
      }));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomBy(-1);
    }
  };

  return (
    <div
      ref={surfaceRef}
      className={`jilu-local-map ${dragging ? "is-dragging" : ""} ${hasDetailedTiles ? "has-detailed-tiles" : ""} ${STATIC_DEMO_MODE ? "is-static-demo" : ""} ${baiduStaticImageUrl ? "is-baidu-static" : ""}`}
      tabIndex={0}
      role="application"
      aria-label={STATIC_DEMO_MODE
        ? "北京离线路线演示地图；点击地点标记查看信息"
        : "可拖动缩放的本地路线演示地图；方向键平移，加减键缩放"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      style={{
        "--jilu-local-route-weight": `${routeStrokeWeightForZoom(viewport.zoom, true)}px`,
      }}
      data-map-surface={baiduStaticImageUrl ? "baidu-static-image" : "local-demo"}
      data-map-background={baiduStaticImageUrl
        ? "baidu-static-image"
        : STATIC_DEMO_MODE
        ? "beijing-static-map"
        : hasDetailedTiles ? "osm-raster" : "local-vector"}
      data-static-demo={STATIC_DEMO_MODE ? "true" : "false"}
      data-route-geometry={routeGeometry}
    >
      {STATIC_DEMO_MODE && (
        <img
          className="jilu-local-map__static-backdrop"
            src={assetUrl("/assets/beijing-baidu-style-offline-map.png")}
          alt=""
          aria-hidden="true"
          draggable="false"
        />
      )}

      {baiduStaticImageUrl && (
        <img
          className="jilu-local-map__static-backdrop jilu-local-map__baidu-backdrop"
          src={baiduStaticImageUrl}
          alt=""
          aria-hidden="true"
          draggable="false"
          onLoad={() => setHasDetailedTiles(true)}
          onError={() => setHasDetailedTiles(false)}
        />
      )}

      {!baiduStaticImageUrl && (
        <DetailedRasterTileLayer
          viewport={viewport}
          width={size.width}
          height={size.height}
          tileUrlTemplate={rasterTileUrlTemplate}
          onCoverageChange={handleTileCoverageChange}
        />
      )}

      <svg
        className="jilu-local-map__art"
        viewBox={`0 0 ${size.width} ${size.height}`}
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        <defs>
          <pattern id={patternId} width="52" height="52" patternUnits="userSpaceOnUse">
            <path d="M 52 0 L 0 0 0 52" fill="none" stroke="#dfe3dc" strokeWidth="0.8" />
          </pattern>
          <filter id={`${patternId}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#677063" floodOpacity="0.18" />
          </filter>
        </defs>
        <g className="jilu-local-map__fallback-details">
          <rect width="100%" height="100%" fill="#f8f8f3" />
          <rect width="100%" height="100%" fill={`url(#${patternId})`} opacity="0.42" />
          {DEMO_WATER.map((polygon, index) => (
            <polygon
              key={`water-${index}`}
              points={pointsAttribute(polygon, fullViewport)}
              className="jilu-local-map__water"
            />
          ))}
          {DEMO_ROADS.map((road) => (
            <g key={road.id}>
              <polyline
                points={pointsAttribute(road.points, fullViewport)}
                className={`jilu-local-map__road-outline is-${road.kind}`}
              />
              <polyline
                points={pointsAttribute(road.points, fullViewport)}
                className={`jilu-local-map__road is-${road.kind}`}
              />
            </g>
          ))}
          {DEMO_LABELS.map((label) => {
            const screen = projectToScreen(label, fullViewport);
            return (
              <text
                key={label.id}
                x={screen.x}
                y={screen.y}
                className="jilu-local-map__district-label"
              >
                {label.name}
              </text>
            );
          })}
        </g>
        {routePoints && (
          <>
            <polyline points={routePoints} className="jilu-local-map__route-shadow" />
            <polyline points={routePoints} className="jilu-local-map__route" />
          </>
        )}
      </svg>

      {projectedPlaces.map(({ place, screen }, index) => {
        const isActive = String(place.id) === String(activeStopId);
        return (
          <button
            type="button"
            key={place.id}
            className={`jilu-map-marker ${isActive ? "is-active" : ""}`}
            style={{ left: screen.x, top: screen.y }}
            data-map-marker
            data-stop-id={place.id}
            aria-label={`第 ${index + 1} 站，${place.name}${isActive ? "，当前选中" : ""}`}
            aria-pressed={isActive}
            onClick={() => onSelectStop?.(place.id)}
          >
            <span>{index + 1}</span>
            <small>{place.name}</small>
          </button>
        );
      })}

      {projectedCurrentLocation && (
        <span
          className="jilu-current-location"
          style={{ left: projectedCurrentLocation.x, top: projectedCurrentLocation.y }}
          role="img"
          aria-label="你的浏览器定位位置（WGS84）"
        >
          <i />
        </span>
      )}

      {STATIC_DEMO_MODE && activeProjectedPlace && (
        <article
          className="jilu-map-active-callout"
          style={{
            left: activeProjectedPlace.screen.x,
            top: activeProjectedPlace.screen.y,
          }}
          aria-live="polite"
        >
          {activeProjectedPlace.place.image && (
                  <img src={assetUrl(activeProjectedPlace.place.image)} alt="" />
          )}
          <span>
            <small>{activeProjectedPlace.place.time || `第 ${activeProjectedPlace.place.routeIndex + 1} 站`}</small>
            <strong>{activeProjectedPlace.place.name}</strong>
          </span>
        </article>
      )}

      {isLoadingBaidu && (
        <div className="jilu-map-loading" role="status">
          <span />
          正在连接百度地图，当前可先操作演示底图
        </div>
      )}

      {rasterTileUrlTemplate ? (
        <a
          className="jilu-map-attribution"
          href={DEFAULT_RASTER_ATTRIBUTION_URL}
          target="_blank"
          rel="noreferrer"
          data-map-interactive-control
          onPointerDown={(event) => event.stopPropagation()}
        >
          © OpenStreetMap contributors
        </a>
      ) : null}

      {activePlace && (
        <article className="jilu-map-selection" aria-live="polite">
          <span>第 {activePlace.routeIndex + 1} 站</span>
          <strong>{activePlace.name}</strong>
          {activePlace.address && <small>{activePlace.address}</small>}
          {!activePlace.hasVerifiedCoordinates && (
            <em>此地点暂用演示位置，接入地图后需重新解析</em>
          )}
        </article>
      )}
    </div>
  );
});

const BaiduMapSurface = forwardRef(function BaiduMapSurface({
  BMapGL,
  providerReady,
  places,
  activeStopId,
  onSelectStop,
  currentLocation,
  defaultCity,
  routeMode,
  enableRouteSearch,
  compact,
  onReady,
  onError,
}, ref) {
  const containerRef = useRef(null);
  const destroyTimerRef = useRef(null);
  const mapRef = useRef(null);
  const resolvedPlacesRef = useRef([]);
  const [resolvedPlaces, setResolvedPlaces] = useState(
    () => places.filter((place) => place.hasVerifiedCoordinates),
  );
  const [coordinateStatus, setCoordinateStatus] = useState("");
  const [routeStatus, setRouteStatus] = useState("");
  const [visualZoom, setVisualZoom] = useState(null);
  const [visualRouteWeight, setVisualRouteWeight] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    if (destroyTimerRef.current !== null) {
      window.clearTimeout(destroyTimerRef.current);
      destroyTimerRef.current = null;
    }

    const scheduleDestroy = (map) => {
      destroyTimerRef.current = window.setTimeout(() => {
        if (mapRef.current !== map) return;
        try {
          map.clearOverlays?.();
        } catch {
          // Baidu may already have invalidated a rejected map instance.
        }
        try {
          map.destroy?.();
        } catch {
          // Keep React mounted when provider-side authorization tears down WebGL first.
        }
        if (mapRef.current === map) mapRef.current = null;
        destroyTimerRef.current = null;
      }, 0);
    };

    const armSurfaceReadiness = (map) => {
      let settled = false;
      let paintTimer = null;
      let runtimeTimer = null;
      let renderingCanvas = null;
      const handleContextLost = (event) => {
        event.preventDefault?.();
        onError?.(new Error("百度地图 WebGL 渲染已中断，已切换到详细演示底图"));
      };
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (runtimeTimer !== null) window.clearTimeout(runtimeTimer);
        map.removeEventListener?.("tilesloaded", handleTilesLoaded);
        if (error) {
          onError?.(error);
          return;
        }
        paintTimer = window.setTimeout(
          () => onReady?.(),
          BAIDU_SURFACE_PAINT_DELAY_MS,
        );
      };
      const handleTilesLoaded = () => {
        const canvas = containerRef.current?.querySelector("canvas");
        if (canvas) {
          renderingCanvas = canvas;
          renderingCanvas.addEventListener("webglcontextlost", handleContextLost);
        }
        finish();
      };
      const timeout = window.setTimeout(
        () => finish(new Error("百度地图底图渲染超时，已切换到详细演示底图")),
        BAIDU_SURFACE_READY_TIMEOUT_MS,
      );
      map.addEventListener?.("tilesloaded", handleTilesLoaded);
      runtimeTimer = window.setTimeout(() => {
        const providerContainer = map.getContainer?.();
        if (
          providerContainer
          && providerContainer === containerRef.current
          && typeof map.getCenter === "function"
          && typeof map.getZoom === "function"
        ) {
          finish();
        }
      }, 900);

      return () => {
        settled = true;
        window.clearTimeout(timeout);
        if (runtimeTimer !== null) window.clearTimeout(runtimeTimer);
        if (paintTimer !== null) window.clearTimeout(paintTimer);
        map.removeEventListener?.("tilesloaded", handleTilesLoaded);
        renderingCanvas?.removeEventListener("webglcontextlost", handleContextLost);
      };
    };

    if (mapRef.current) {
      const existingMap = mapRef.current;
      const disarmReadiness = armSurfaceReadiness(existingMap);
      try {
        existingMap.checkResize?.();
      } catch {
        // The runtime health check will handle an invalid provider instance.
      }
      return () => {
        disarmReadiness();
        scheduleDestroy(existingMap);
      };
    }

    const initialPoints = places
      .filter((place) => place.hasVerifiedCoordinates)
      .map(({ lat, lng }) => ({ lat, lng }));
    const initial = fitMapViewport(initialPoints, 720, 420, 72);
    let map;
    let disarmReadiness = () => {};
    try {
      map = new BMapGL.Map(containerRef.current);
      disarmReadiness = armSurfaceReadiness(map);
      map.centerAndZoom(
        new BMapGL.Point(initial.center.lng, initial.center.lat),
        Math.round(initial.zoom),
      );
      map.enableScrollWheelZoom(true);
      map.enableDragging();
      mapRef.current = map;
    } catch (error) {
      disarmReadiness();
      onError?.(error);
      return undefined;
    }

    return () => {
      disarmReadiness();
      scheduleDestroy(map);
    };
  }, [BMapGL, onError, onReady]);

  useEffect(() => {
    let cancelled = false;
    const verified = places.filter((place) => place.hasVerifiedCoordinates);
    const missing = places.filter((place) => !place.hasVerifiedCoordinates);
    const anchored = [];
    const geocodeCandidates = [];

    missing.forEach((place) => {
      const anchor = demoBaiduAnchorForPlace(place);
      if (anchor) {
        anchored.push({
          ...place,
          lat: anchor.lat,
          lng: anchor.lng,
          geocodedByBaidu: true,
          hasVerifiedCoordinates: true,
          coordSystem: "BD09LL",
        });
      } else {
        geocodeCandidates.push(place);
      }
    });

    const resolvedImmediately = [...verified, ...anchored]
      .sort((left, right) => left.routeIndex - right.routeIndex);
    setResolvedPlaces(resolvedImmediately);

    if (geocodeCandidates.length === 0 || !BMapGL.Geocoder) {
      setCoordinateStatus(
        geocodeCandidates.length
          ? `${geocodeCandidates.length} 个地点缺少坐标，未绘制`
          : "",
      );
      return () => {
        cancelled = true;
      };
    }

    setCoordinateStatus(`正在解析 ${geocodeCandidates.length} 个缺少坐标的地点…`);
    const geocoder = new BMapGL.Geocoder();
    Promise.all(geocodeCandidates.map((place) => new Promise((resolve) => {
      const query = geocodeQueryForPlace(place);
      if (!query) {
        resolve(null);
        return;
      }
      geocoder.getPoint(
        query,
        (point) => resolve(point ? {
          ...place,
          lat: point.lat,
          lng: point.lng,
          geocodedByBaidu: true,
          hasVerifiedCoordinates: true,
          coordSystem: "BD09",
        } : null),
        place.city || defaultCity,
      );
    }))).then((matches) => {
      if (cancelled) return;
      const geocoded = matches.filter(Boolean);
      const next = [...resolvedImmediately, ...geocoded]
        .sort((left, right) => left.routeIndex - right.routeIndex);
      setResolvedPlaces(next);
      const unresolved = geocodeCandidates.length - geocoded.length;
      setCoordinateStatus(unresolved ? `${unresolved} 个地点仍缺少坐标，已跳过` : "");
    });

    return () => {
      cancelled = true;
    };
  }, [BMapGL, defaultCity, places]);

  useEffect(() => {
    resolvedPlacesRef.current = resolvedPlaces;
  }, [resolvedPlaces]);

  const fitRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map) return null;
    const points = resolvedPlacesRef.current.map(
      (place) => new BMapGL.Point(place.lng, place.lat),
    );
    if (currentLocation) points.push(new BMapGL.Point(currentLocation.lng, currentLocation.lat));
    if (points.length > 1) {
      map.setViewport(points, {
        margins: compact
          ? [88, 52, 98, 52]
          : [96, 72, 96, 72],
        enableAnimation: false,
      });
    } else if (points.length === 1) {
      map.centerAndZoom(points[0], 15);
    }
    return points.length;
  }, [BMapGL, compact, currentLocation]);

  useEffect(() => {
    if (resolvedPlaces.length === 0) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      try {
        fitRoute();
      } catch {
        // Provider authorization can invalidate the map while geocoding resolves.
      }
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [fitRoute, resolvedPlaces]);

  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container || !map || typeof ResizeObserver === "undefined") return undefined;

    let frameId = null;
    const observer = new ResizeObserver(() => {
      try {
        map.checkResize?.();
        if (typeof requestAnimationFrame === "function") {
          if (frameId !== null) cancelAnimationFrame(frameId);
          frameId = requestAnimationFrame(() => {
            try {
              fitRoute();
            } catch {
              // Provider authorization can invalidate the map before this frame runs.
            }
          });
        } else {
          fitRoute();
        }
      } catch {
        // The parent health check will switch to the detailed fallback map.
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (frameId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frameId);
      }
    };
  }, [fitRoute]);

  const zoomBy = useCallback((amount) => {
    const map = mapRef.current;
    if (!map) return null;
    if (amount > 0) {
      map.zoomIn();
    } else {
      map.zoomOut();
    }
    return map.getZoom();
  }, []);

  const locate = useCallback(async () => {
    const result = await baiduGeolocation(BMapGL);
    const map = mapRef.current;
    if (map) {
      map.panTo(new BMapGL.Point(result.lng, result.lat));
      if (map.getZoom() < 15) map.setZoom(15);
    }
    return result;
  }, [BMapGL]);

  useImperativeHandle(ref, () => ({
    fitRoute,
    zoomIn: () => zoomBy(1),
    zoomOut: () => zoomBy(-1),
    locate,
  }), [fitRoute, locate, zoomBy]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !providerReady) return undefined;

    const ownedOverlays = [];
    const addOwnedOverlay = (overlay) => {
      map.addOverlay(overlay);
      ownedOverlays.push(overlay);
      return overlay;
    };

    map.clearOverlays();

    const points = resolvedPlaces.map((place) => new BMapGL.Point(place.lng, place.lat));
    const routeLines = [];
    const markerLabels = [];
    let activeCallout = null;
    let activeCalloutPoint = null;

    const styleRouteLine = ({ line, kind = "road" }) => {
      line?.setStrokeColor?.("#5f7f63");
      const roadWeight = routeStrokeWeightForZoom(map.getZoom(), compact);
      line?.setStrokeWeight?.(kind === "preview" ? Math.max(1, roadWeight - 1) : roadWeight);
      line?.setStrokeOpacity?.(kind === "preview" ? 0.46 : compact ? 0.82 : 0.78);
      line?.setStrokeStyle?.(kind === "preview" ? "dashed" : "solid");
    };

    const styleMarkerLabel = ({ label, isActive }) => {
      const visual = markerVisualForZoom(map.getZoom(), compact, isActive);
      label.setOffset?.(new BMapGL.Size(-visual.diameter / 2, -visual.diameter / 2));
      label.setStyle({
        width: `${visual.diameter}px`,
        height: `${visual.diameter}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        lineHeight: "1",
        textAlign: "center",
        border: `${visual.borderWidth}px solid #ffffff`,
        borderRadius: "50%",
        background: isActive ? "#111111" : "#6f8f72",
        color: "#ffffff",
        boxShadow: compact
          ? "0 2px 7px rgba(17,17,17,.2)"
          : "0 3px 10px rgba(17,17,17,.22)",
        cursor: "pointer",
        fontWeight: "700",
        fontSize: `${visual.fontSize}px`,
        padding: "0",
      });
      label.setZIndex?.(isActive ? 30 : 20);
    };

    const positionActiveCallout = () => {
      if (!activeCallout || !activeCalloutPoint || !containerRef.current) return;
      const pixel = map.pointToOverlayPixel?.(activeCalloutPoint);
      if (!pixel) return;
      const bounds = containerRef.current.getBoundingClientRect();
      const calloutWidth = compact ? 116 : 142;
      const calloutHeight = compact ? 44 : 50;
      const placeOnRight = pixel.x + calloutWidth + 20 <= bounds.width;
      const placeBelow = pixel.y - calloutHeight - 12 < 50;
      activeCallout.setOffset?.(new BMapGL.Size(
        placeOnRight ? 18 : -calloutWidth - 30,
        placeBelow ? 16 : -calloutHeight - 18,
      ));
    };

    const updateOverlayScale = () => {
      const zoom = map.getZoom();
      setVisualZoom(zoom);
      setVisualRouteWeight(routeStrokeWeightForZoom(zoom, compact));
      routeLines.forEach(styleRouteLine);
      markerLabels.forEach(styleMarkerLabel);
      positionActiveCallout();
    };

    resolvedPlaces.forEach((place, index) => {
      const point = points[index];
      const isActive = String(place.id) === String(activeStopId);

      const label = new BMapGL.Label(String(index + 1), {
        position: point,
        offset: new BMapGL.Size(0, 0),
      });
      const markerLabel = { label, isActive };
      markerLabels.push(markerLabel);
      styleMarkerLabel(markerLabel);
      label.setTitle?.(`第 ${index + 1} 站 · ${place.name}`);
      label.addEventListener("click", () => onSelectStop?.(place.id));
      addOwnedOverlay(label);
    });

    const activeIndex = resolvedPlaces.findIndex(
      (place) => String(place.id) === String(activeStopId),
    );
    if (compact && activeIndex >= 0) {
      const activePlace = resolvedPlaces[activeIndex];
      activeCalloutPoint = points[activeIndex];
    const image = activePlace.image
      ? `<img src="${escapeMapHtml(assetUrl(activePlace.image))}" alt="">`
        : "";
      activeCallout = new BMapGL.Label(
        `<span class="jilu-baidu-active-callout">${image}<span><small>${escapeMapHtml(activePlace.time || `第 ${activeIndex + 1} 站`)}</small><strong>${escapeMapHtml(activePlace.name)}</strong></span></span>`,
        {
          position: activeCalloutPoint,
          offset: new BMapGL.Size(0, 0),
        },
      );
      activeCallout.setStyle({
        width: compact ? "116px" : "142px",
        padding: "0",
        border: "0",
        background: "transparent",
        boxShadow: "none",
        cursor: "pointer",
      });
      activeCallout.setZIndex?.(40);
      activeCallout.addEventListener("click", () => onSelectStop?.(activePlace.id));
      addOwnedOverlay(activeCallout);
      positionActiveCallout();
    }

    if (currentLocation) {
      const point = new BMapGL.Point(currentLocation.lng, currentLocation.lat);
      const locationMarker = new BMapGL.Marker(point);
      locationMarker.setTitle?.("你的位置");
      addOwnedOverlay(locationMarker);
      const label = new BMapGL.Label("你的位置", {
        position: point,
        offset: new BMapGL.Size(12, -28),
      });
      label.setStyle({
        padding: "5px 9px",
        border: "1px solid #7364c9",
        borderRadius: "9px",
        background: "#ffffff",
        color: "#4f439a",
        fontSize: "12px",
        boxShadow: "0 3px 10px rgba(82,68,154,.18)",
      });
      addOwnedOverlay(label);
    }

    map.addEventListener?.("zoomend", updateOverlayScale);
    map.addEventListener?.("moveend", positionActiveCallout);
    updateOverlayScale();

    let cancelled = false;
    const routeSearches = [];
    const RoutePlanner = routeMode === "driving" && BMapGL.DrivingRoute
      ? BMapGL.DrivingRoute
      : BMapGL.WalkingRoute;
    if (enableRouteSearch && RoutePlanner && points.length > 1) {
      const routeLabel = routeMode === "driving" ? "驾车" : "步行";
      setRouteStatus(`正在沿百度道路规划 ${points.length - 1} 段${routeLabel}路线…`);
      let completed = 0;
      let succeeded = 0;
      const totalSegments = points.length - 1;

      const updateRouteProgress = (renderedPath) => {
        completed += 1;
        if (renderedPath) succeeded += 1;
        if (completed !== totalSegments) return;
        setRouteStatus(
          succeeded === completed
            ? `百度道路路线 · ${completed}/${completed} 段`
            : succeeded > 0
              ? `百度道路路线 · ${succeeded}/${completed} 段，未加载段不画错误直线`
              : "百度道路路线暂未返回，仅显示已校准的真实地点",
        );
      };

      const renderRoutePaths = (paths) => {
        let renderedPath = false;
        paths.forEach((path) => {
          const routePoints = path.map(
            ({ lng, lat }) => new BMapGL.Point(lng, lat),
          );
          if (routePoints.length < 2) return;
          const line = new BMapGL.Polyline(routePoints, {
            strokeColor: "#5f7f63",
            strokeWeight: routeStrokeWeightForZoom(map.getZoom(), compact),
            strokeOpacity: compact ? 0.82 : 0.78,
            strokeStyle: "solid",
            enableClicking: false,
          });
          const routeLine = { line, kind: "road" };
          routeLines.push(routeLine);
          addOwnedOverlay(line);
          styleRouteLine(routeLine);
          renderedPath = true;
        });
        return renderedPath;
      };

      for (let index = 0; index < points.length - 1; index += 1) {
        const cacheKey = routeGeometryCacheKey(
          routeMode,
          resolvedPlaces[index],
          resolvedPlaces[index + 1],
        );
        const cachedPaths = baiduRouteGeometryCache.get(cacheKey);
        if (cachedPaths) {
          updateRouteProgress(renderRoutePaths(cachedPaths));
          continue;
        }

        const routeSearch = new RoutePlanner(defaultCity, {
          onSearchComplete(results) {
            if (cancelled) return;
            const status = typeof routeSearch.getStatus === "function"
              ? routeSearch.getStatus()
              : null;
            const paths = [];
            if (status === (window.BMAP_STATUS_SUCCESS ?? 0)) {
              const plan = results?.getPlan?.(0);
              const routeCount = plan?.getNumRoutes?.() ?? 0;
              for (let routeIndex = 0; routeIndex < routeCount; routeIndex += 1) {
                const path = plan.getRoute?.(routeIndex)?.getPath?.() ?? [];
                if (path.length < 2) continue;
                paths.push(path.map(({ lng, lat }) => ({ lng, lat })));
              }
            }
            if (paths.length > 0) {
              baiduRouteGeometryCache.set(cacheKey, paths);
              if (baiduRouteGeometryCache.size > 120) {
                const oldestKey = baiduRouteGeometryCache.keys().next().value;
                baiduRouteGeometryCache.delete(oldestKey);
              }
            }
            updateRouteProgress(renderRoutePaths(paths));
          },
        });
        routeSearch.search(points[index], points[index + 1]);
        routeSearches.push(routeSearch);
      }
    } else {
      if (points.length > 1) {
        const previewLine = new BMapGL.Polyline(points, {
          strokeColor: "#6f8f72",
          strokeWeight: Math.max(1, routeStrokeWeightForZoom(map.getZoom(), compact) - 1),
          strokeOpacity: 0.46,
          strokeStyle: "dashed",
        });
        routeLines.push({ line: previewLine, kind: "preview" });
        addOwnedOverlay(previewLine);
        setRouteStatus("地点顺序预览 · 未启用道路路线");
      } else {
        setRouteStatus("");
      }
    }

    return () => {
      cancelled = true;
      map.removeEventListener?.("zoomend", updateOverlayScale);
      map.removeEventListener?.("moveend", positionActiveCallout);
      routeSearches.forEach((routeSearch) => {
        try {
          routeSearch.clearResults?.();
        } catch {
          // The rejected provider runtime may have already removed its map panes.
        }
      });
      for (let index = ownedOverlays.length - 1; index >= 0; index -= 1) {
        try {
          map.removeOverlay?.(ownedOverlays[index]);
        } catch {
          // The provider may already have discarded this overlay during teardown.
        }
      }
    };
  }, [
    BMapGL,
    activeStopId,
    compact,
    currentLocation,
    defaultCity,
    enableRouteSearch,
    onSelectStop,
    providerReady,
    resolvedPlaces,
    routeMode,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    const active = resolvedPlaces.find((place) => String(place.id) === String(activeStopId));
    if (map && active) {
      map.panTo(new BMapGL.Point(active.lng, active.lat));
    }
  }, [BMapGL, activeStopId, resolvedPlaces]);

  return (
    <div
      className="jilu-baidu-map-shell"
      data-map-zoom={visualZoom ?? ""}
      data-route-weight={visualRouteWeight ?? ""}
      data-route-kind={enableRouteSearch ? "baidu-road" : "point-preview"}
    >
      <div
        ref={containerRef}
        className="jilu-baidu-map"
        role="application"
        aria-label="百度地图，可拖动和缩放"
        data-map-surface="baidu-jsapi"
      />
      {(coordinateStatus || routeStatus) && (
        <div className="jilu-baidu-map-status" role="status">
          {routeStatus && <span>{routeStatus}</span>}
          {coordinateStatus && <span>{coordinateStatus}</span>}
        </div>
      )}
    </div>
  );
});

/**
 * Reusable route map.
 *
 * Required integration props:
 * - places: [{id, name, lat/lng or latitude/longitude, ...}]
 * - routeOrder: stop IDs (or schedule entries containing stopId)
 * - activeStopId / onSelectStop: synchronized selection
 * - enableBaiduRouteSearch: use Baidu road geometry instead of point-to-point lines
 * - compact: keep the small toolbar while hiding the internal selection/footer
 * - showChrome: set false when the host page supplies its own map controls
 * - routeGeometry: local fallback geometry, "direct" or "street-grid"
 *
 * The forwarded ref exposes fitRoute(), zoomIn(), zoomOut() and locate().
 */
export const InteractiveRouteMap = forwardRef(function InteractiveRouteMap({
  places = [],
  routeOrder = [],
  activeStopId = null,
  onSelectStop,
  className = "",
  style,
  ariaLabel = "旅行路线交互地图",
  baiduMapAk = STATIC_DEMO_MODE ? "" : import.meta.env.VITE_BAIDU_MAP_AK,
  defaultCity = "北京市",
  enableBaiduRouteSearch = true,
  routeMode = "walking",
  rasterTileUrlTemplate = STATIC_DEMO_MODE
    ? ""
    : import.meta.env.VITE_MAP_TILE_URL || DEFAULT_RASTER_TILE_URL,
  onLocationChange,
  onModeChange,
  compact = false,
  showChrome = true,
  showRoute = true,
  routeGeometry = "direct",
}, ref) {
  const configuredAk = typeof baiduMapAk === "string" ? baiduMapAk.trim() : "";
  const [mode, setMode] = useState(configuredAk ? "baidu-static" : "fallback");
  const [BMapGL, setBMapGL] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [currentLocation, setCurrentLocation] = useState(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const baiduSurfaceActionsRef = useRef(null);
  const fallbackSurfaceActionsRef = useRef(null);
  const apiPromiseRef = useRef(null);

  const normalizedPlaces = useMemo(
    () => normalizeMapPlaces(places, routeOrder),
    [places, routeOrder],
  );

  useEffect(() => {
    if (!configuredAk) {
      setMode("fallback");
      setBMapGL(null);
      setLoadError("");
      onModeChange?.({ mode: "fallback", reason: "MISSING_AK" });
      return undefined;
    }

    setMode("baidu-static");
    setBMapGL(null);
    setLoadError("");
    apiPromiseRef.current = null;
    onModeChange?.({ mode: "baidu-static" });

    return undefined;
  }, [configuredAk, onModeChange]);

  const markBaiduSurfaceReady = useCallback(() => {
    setLoadError("");
    setMode("baidu");
    onModeChange?.({ mode: "baidu" });
  }, [onModeChange]);

  const markBaiduSurfaceFailed = useCallback((cause) => {
    const error = cause instanceof Error
      ? cause
      : new Error("百度地图底图未能完成渲染");
    setBMapGL(null);
    setLoadError(error.message);
    setMode("fallback");
    onModeChange?.({ mode: "fallback", reason: "SURFACE_RENDER_FAILED", error });
  }, [onModeChange]);

  useEffect(() => {
    if (mode !== "baidu" || !BMapGL) return undefined;

    const timer = window.setTimeout(() => {
      const runtimeReady = (
        typeof window.BMapGL?.Map === "function"
        && typeof BMapGL?.Map === "function"
      );
      if (runtimeReady) return;

      const error = new Error(
        "百度地图运行授权未通过，请检查浏览器端 AK、Referer 白名单和 JSAPI GL 服务状态",
      );
      setBMapGL(null);
      setLoadError(error.message);
      setMode("fallback");
      onModeChange?.({ mode: "fallback", reason: "RUNTIME_AUTH_FAILED", error });
    }, BAIDU_RUNTIME_HEALTH_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [BMapGL, mode, onModeChange]);

  const locate = useCallback(async () => {
    if (isLocating) return currentLocation;
    setIsLocating(true);
    setLocationMessage("正在定位…");

    try {
      let result;
      if (configuredAk && mode === "baidu") {
        const api = BMapGL ?? await apiPromiseRef.current;
        result = baiduSurfaceActionsRef.current?.locate
          ? await baiduSurfaceActionsRef.current.locate()
          : await baiduGeolocation(api);
      } else {
        result = await browserGeolocation();
      }
      setCurrentLocation(result);
      setLocationMessage(
        result.source === "BAIDU_GEOLOCATION"
          ? "已通过百度定位到当前位置"
          : "已获取浏览器位置（WGS84，仅用于演示底图）",
      );
      onLocationChange?.(result);
      return result;
    } catch (error) {
      if (configuredAk && mode === "fallback") {
        try {
          const fallbackResult = await browserGeolocation();
          setCurrentLocation(fallbackResult);
          setLocationMessage("百度地图不可用；已用浏览器 WGS84 定位展示在演示底图");
          onLocationChange?.(fallbackResult);
          return fallbackResult;
        } catch {
          // Keep the original Baidu error because it explains the active mode.
        }
      }
      setLocationMessage(error.message || "定位失败");
      throw error;
    } finally {
      setIsLocating(false);
    }
  }, [
    BMapGL,
    configuredAk,
    currentLocation,
    isLocating,
    mode,
    onLocationChange,
  ]);

  const fitRoute = useCallback(
    () => (
      mode === "baidu"
        ? baiduSurfaceActionsRef.current?.fitRoute?.()
        : fallbackSurfaceActionsRef.current?.fitRoute?.()
    ) ?? null,
    [mode],
  );
  const zoomIn = useCallback(
    () => (
      mode === "baidu"
        ? baiduSurfaceActionsRef.current?.zoomIn?.()
        : fallbackSurfaceActionsRef.current?.zoomIn?.()
    ) ?? null,
    [mode],
  );
  const zoomOut = useCallback(
    () => (
      mode === "baidu"
        ? baiduSurfaceActionsRef.current?.zoomOut?.()
        : fallbackSurfaceActionsRef.current?.zoomOut?.()
    ) ?? null,
    [mode],
  );

  useImperativeHandle(ref, () => ({
    fitRoute,
    zoomIn,
    zoomOut,
    locate,
    getMode: () => mode,
  }), [fitRoute, locate, mode, zoomIn, zoomOut]);

  const activePlace = normalizedPlaces.find(
    (place) => String(place.id) === String(activeStopId),
  );
  const hasBaiduRuntime = Boolean(BMapGL) && mode !== "fallback";
  const isBaidu = mode === "baidu" && hasBaiduRuntime;
  const isBaiduStatic = mode === "baidu-static" && Boolean(configuredAk);
  const isBaiduProvider = isBaidu || isBaiduStatic;

  const rootClassName = [
    "jilu-interactive-map",
    "is-embedded",
    isBaiduProvider ? "is-baidu-provider" : "is-local-provider",
    compact ? "is-compact" : "",
    showChrome ? "" : "is-chrome-hidden",
    className,
  ].filter(Boolean).join(" ");

  return (
    <section
      className={rootClassName}
      style={style}
      aria-label={ariaLabel}
      data-map-mode={isBaidu ? "baidu" : isBaiduStatic ? "baidu-static" : "local-demo"}
      data-map-render-state={isBaiduProvider ? "ready" : mode === "loading" ? "loading" : "fallback"}
      data-map-actions-ready={
        mode === "baidu"
          ? Boolean(baiduSurfaceActionsRef.current)
          : Boolean(fallbackSurfaceActionsRef.current)
      }
    >
      <header className="jilu-interactive-map__toolbar">
        <div>
          <span className={`jilu-map-mode-badge is-${mode}`}>
            <i />
            {isBaidu
              ? "百度地图 JSAPI · 已连接"
              : isBaiduStatic
                ? "百度地图静态底图 · 已连接"
              : mode === "loading"
                ? "正在连接百度地图"
                : STATIC_DEMO_MODE
                  ? "北京离线演示地图 · 标记可点击"
                  : "北京详细开放底图 · 非实时百度地图"}
          </span>
          {loadError && (
            <small title={loadError}>百度地图未加载，已自动切换演示底图</small>
          )}
        </div>

        <nav aria-label="地图操作">
          <button type="button" onClick={fitRoute} aria-label="查看完整路线" title="完整路线">
            <FitIcon />
          </button>
          {!STATIC_DEMO_MODE && (
            <>
              <button type="button" onClick={zoomIn} aria-label="放大地图" title="放大">
                <PlusIcon />
              </button>
              <button type="button" onClick={zoomOut} aria-label="缩小地图" title="缩小">
                <MinusIcon />
              </button>
              <button
                type="button"
                className="is-locate"
                onClick={() => locate().catch(() => {})}
                disabled={isLocating}
                aria-label={isLocating ? "正在定位" : "定位到当前位置"}
                title="我的位置"
              >
                <LocateIcon />
              </button>
            </>
          )}
        </nav>
      </header>

      <div className="jilu-interactive-map__surface">
        {hasBaiduRuntime ? (
          <BaiduMapSurface
            ref={baiduSurfaceActionsRef}
            BMapGL={BMapGL}
            providerReady={isBaidu}
            places={normalizedPlaces}
            activeStopId={activeStopId}
            onSelectStop={onSelectStop}
            currentLocation={currentLocation}
            defaultCity={defaultCity}
            enableRouteSearch={showRoute && enableBaiduRouteSearch}
            routeMode={routeMode}
            compact={compact}
            onReady={markBaiduSurfaceReady}
            onError={markBaiduSurfaceFailed}
          />
        ) : null}
        {!isBaidu ? (
          <LocalMapSurface
            ref={fallbackSurfaceActionsRef}
            places={normalizedPlaces}
            activeStopId={activeStopId}
            onSelectStop={onSelectStop}
            currentLocation={currentLocation}
            isLoadingBaidu={mode === "loading"}
            rasterTileUrlTemplate={rasterTileUrlTemplate}
            baiduStaticAk={isBaiduStatic ? configuredAk : ""}
            showRoute={showRoute}
            routeGeometry={routeGeometry}
          />
        ) : null}
      </div>

      <footer className="jilu-interactive-map__footer">
        <div aria-live="polite">
          {locationMessage || (
            isBaidu
              ? "百度地图已连接；可拖动、滚轮缩放和点击地点，定位使用百度 Geolocation"
              : isBaiduStatic
                ? "百度地图底图已连接；可点击地点查看介绍，搜索会同步筛选卡片与地图标点"
              : STATIC_DEMO_MODE
                ? "北京离线演示底图已加载；点击地点查看行程信息，不依赖百度地图 AK"
                : "可拖动、滚轮缩放和点击地点；道路背景来自开放地图，不提供实时路况或导航"
          )}
        </div>
        {activePlace && (
          <span>
            当前地点：<strong>{activePlace.name}</strong>
          </span>
        )}
      </footer>
    </section>
  );
});

InteractiveRouteMap.displayName = "InteractiveRouteMap";

export default InteractiveRouteMap;
