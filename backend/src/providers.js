import { randomUUID } from "node:crypto";
import { xiaohongshuMockRouteId } from "./seed.js";

function haversineMeters(left, right) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const deltaLat = radians(right.lat - left.lat);
  const deltaLng = radians(right.lng - left.lng);
  const lat1 = radians(left.lat);
  const lat2 = radians(right.lat);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bookingOptionsForTrip(trip) {
  return trip.stops.map((stop) => {
    const dining = /咖啡|胡同|什刹海/.test(stop.name);
    const placeName = stop.name;
    const address = stop.address || `${trip.city} · 地址待确认`;
    return {
      bookingOptionId: `mock-meituan:${trip.tripId}:${stop.clientStopId}`,
      tripRevisionId: trip.revisionId,
      clientStopId: stop.clientStopId,
      internalPlaceId: stop.placeId,
      placeId: stop.placeId,
      placeName,
      address,
      location: {
        name: placeName,
        address,
        latitude: stop.latitude ?? null,
        longitude: stop.longitude ?? null,
        coordSystem: stop.coordSystem ?? null
      },
      title: dining ? `${placeName}附近餐饮服务` : `${placeName}门票或活动服务`,
      productType: dining ? "DINING" : "ACTIVITY",
      provider: "MEITUAN",
      providerMode: "MOCK_NO_PARTNERSHIP",
      availabilityStatus: "SIMULATED",
      price: null,
      currency: null,
      validUntil: null,
      priceText: "待合作接口核验",
      disclosure: "本项仅用于演示按地址匹配合作服务；未查询美团，也不代表已与美团签约。",
      redirectEndpoint: `/api/v1/trips/${encodeURIComponent(trip.tripId)}/booking-options/${encodeURIComponent(`mock-meituan:${trip.tripId}:${stop.clientStopId}`)}/redirects`
    };
  });
}

function findPlaceByAnyId(store, placeId) {
  return store.getPlace(placeId) ??
    store.listPlaces().find((place) => place.baiduProviderId === placeId) ??
    null;
}

function compactText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function titleFromShareText(shareText, shareUrl) {
  const candidate = String(shareText ?? "")
    .replaceAll(shareUrl, " ")
    .replace(/打开小红书(?:查看笔记)?/gu, " ")
    .replace(/复制(?:这段)?(?:内容|文字)/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return candidate.length >= 4 ? compactText(candidate, 80) : null;
}

function providerContentIdFromUrl(value) {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(
      /\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]{6,})/
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function createLocalProviderAdapters({
  store,
  xiaohongshuMetadataResolver = null
}) {
  const metadataPreviewEnabled = typeof xiaohongshuMetadataResolver === "function";
  return {
    catalog() {
      return {
        providers: [
          {
            id: "xiaohongshu",
            capability: "content-handoff",
            mode: metadataPreviewEnabled
              ? "PUBLIC_METADATA_DEMO_WITH_FALLBACK"
              : "USER_HANDOFF_MOCK_NO_PARTNERSHIP",
            connected: false
          },
          {
            id: "baidu",
            capability: "server-place-and-route-data",
            mode: "LOCAL_DETERMINISTIC_MOCK",
            connected: false,
            note: "浏览器百度 JSAPI 底图与后端地点/路线数据接口是两个独立能力。"
          },
          {
            id: "meituan",
            capability: "booking-and-redirect",
            mode: "BOOKING_PLACEHOLDER",
            connected: false
          }
        ],
        warning: "后端合作方数据接口仍为明确标记的本地 Mock；未伪造实时价格、库存或路线。"
      };
    },

    xiaohongshu: {
      async prepareShare({ shareUrl }) {
        if (!metadataPreviewEnabled) {
          return {
            metadataStatus: "FALLBACK",
            fallbackCode: "PREVIEW_DISABLED",
            resolvedUrl: shareUrl,
            title: null,
            description: null,
            authorName: null
          };
        }
        return xiaohongshuMetadataResolver(shareUrl);
      },

      importShare({
        shareUrl,
        shareText = "",
        prepared = null,
        ownerUserId
      }) {
        const route = store.getRoute(xiaohongshuMockRouteId);
        const capturedAt = new Date().toISOString();
        const publicMetadata = prepared?.metadataStatus === "PUBLIC_METADATA";
        const metadataStatus = publicMetadata ? "PUBLIC_METADATA" : "FALLBACK";
        const fallbackCode = publicMetadata
          ? null
          : prepared?.fallbackCode ?? "PREVIEW_DISABLED";
        const noteTitle = publicMetadata
          ? compactText(prepared.title, 120)
          : titleFromShareText(shareText, shareUrl);
        const noteSummary = publicMetadata
          ? compactText(prepared.description, 500)
          : null;
        const authorName = publicMetadata
          ? compactText(prepared.authorName, 100) ?? "公开分享页"
          : "用户主动提供";
        const resolvedUrl = prepared?.resolvedUrl ?? shareUrl;
        const record = {
          importId: `import-${randomUUID()}`,
          status: "READY_FOR_REVIEW",
          source: {
            platform: "XIAOHONGSHU",
            sourceUrl: shareUrl,
            resolvedUrl,
            providerContentId: providerContentIdFromUrl(resolvedUrl),
            label: publicMetadata
              ? "小红书公开分享页 · 演示读取"
              : "小红书用户主动交接 · 演示降级",
            authorName,
            collaborationMode: "USER_INITIATED_MOCK_NO_PARTNERSHIP",
            metadataStatus,
            fallbackCode,
            shareTextProvided: Boolean(
              String(shareText).replace(shareUrl, "").trim()
            ),
            capturedAt
          },
          extraction: {
            mode: publicMetadata
              ? "PUBLIC_METADATA_WITH_DEMO_ROUTE"
              : "DEMO_ROUTE_FALLBACK",
            title: noteTitle
              ? `${noteTitle} · 北京演示行程`
              : route.title,
            city: route.city,
            summary: noteSummary ?? route.summary,
            coverImageUrl: route.coverImageUrl,
            stops: route.stops.map((stop) => {
              const place = store.getPlace(stop.placeId);
              return {
                id: stop.id,
                placeId: stop.placeId,
                providerRefs: place.baiduProviderId
                  ? [{
                      provider: "baidu",
                      providerPlaceId: place.baiduProviderId
                    }]
                  : [],
                name: place.name,
                address: place.address,
                lat: place.lat,
                lng: place.lng,
                coordSystem: place.coordSystem,
                category: place.category,
                suggestedTime: stop.suggestedTime,
                durationMinutes: stop.durationMinutes,
                note: stop.note,
                imageUrl: place.imageUrl,
                locked: Boolean(stop.locked)
              };
            })
          },
          warnings: publicMetadata
            ? [
                "已尽力读取公开分享页的标题或摘要；没有读取账号、私信、未公开内容或正文全文。",
                "当前地点仍使用可编辑的北京演示模板，并非从该笔记正文逐项提取。",
                "未复制第三方图片；地点与动态信息在正式发布前仍需通过合作接口核验。"
              ]
            : [
                `公开分享页信息暂时不可用（${fallbackCode}），已载入可编辑的北京演示路线。`,
                "演示路线地点并非从该笔记正文提取；当前没有调用小红书接口，也不表示已经完成合作接入。",
                "未复制第三方图片或正文；地点坐标来自本地演示种子。"
              ]
        };
        return store.createImport(record, ownerUserId);
      }
    },

    baidu: {
      searchPlaces({ q, city }) {
        const items = store.listPlaces().filter((place) => (
          place.city === city &&
          [place.name, place.address, place.category]
            .join(" ")
            .toLocaleLowerCase("zh-CN")
            .includes(q)
        )).map((place) => ({
          internalPlaceId: place.id,
          providerRefs: [{
            provider: "baidu",
            providerPlaceId: place.baiduProviderId
          }],
          providerPlaceId: place.baiduProviderId,
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          coordSystem: place.coordSystem,
          confidence: 1
        }));
        return {
          provider: { id: "baidu", connected: false, mode: "LOCAL_DETERMINISTIC_MOCK" },
          query: { q, city },
          items,
          warning: "No Baidu server API was called; provider ids and coordinates are local Hackathon mock data."
        };
      },

      getRoute({ originPlaceId, destinationPlaceId, mode }) {
        const origin = findPlaceByAnyId(store, originPlaceId);
        const destination = findPlaceByAnyId(store, destinationPlaceId);
        if (!origin || !destination) return null;
        const straightLineMeters = haversineMeters(origin, destination);
        const distanceFactor = mode === "walking" ? 1.25 : mode === "transit" ? 1.4 : 1.2;
        const speedMetersPerMinute = mode === "walking" ? 75 : mode === "transit" ? 320 : 450;
        const distanceMeters = Math.max(100, Math.round(straightLineMeters * distanceFactor));
        const durationMinutes = Math.max(2, Math.ceil(distanceMeters / speedMetersPerMinute));
        return {
          provider: { id: "baidu", connected: false, mode: "LOCAL_DETERMINISTIC_MOCK" },
          route: {
            origin: {
              internalPlaceId: origin.id,
              providerPlaceId: origin.baiduProviderId
            },
            destination: {
              internalPlaceId: destination.id,
              providerPlaceId: destination.baiduProviderId
            },
            originPlaceId: origin.id,
            destinationPlaceId: destination.id,
            mode,
            distanceMeters,
            durationMinutes,
            polyline: [
              { lat: origin.lat, lng: origin.lng, coordSystem: origin.coordSystem },
              { lat: destination.lat, lng: destination.lng, coordSystem: destination.coordSystem }
            ]
          },
          warning: "This route is a local geometric estimate, not Baidu routing or live traffic."
        };
      }
    },

    meituan: {
      listBookingOptions(trip) {
        return {
          tripId: trip.tripId,
          provider: {
            id: "meituan",
            mode: "MOCK_NO_PARTNERSHIP",
            connected: false
          },
          options: bookingOptionsForTrip(trip),
          warnings: [
            "这些选项没有查询美团库存、价格或订单系统。",
            "真实合作前必须替换为正式授权接口，并实现签名、回调、退款和 SLA。"
          ]
        };
      },

      createRedirect({ trip, bookingOptionId }) {
        const option = bookingOptionsForTrip(trip)
          .find((item) => item.bookingOptionId === bookingOptionId);
        if (!option) return null;
        const record = store.addBookingRedirect({
          redirectId: `booking-redirect-${randomUUID()}`,
          tripId: trip.tripId,
          bookingOptionId,
          status: "MOCK_PLACEHOLDER",
          createdAt: new Date().toISOString()
        });
        return {
          ...record,
          receiptStatus: "MOCK_RECORDED",
          tripRevisionId: trip.revisionId,
          clientStopId: option.clientStopId,
          option,
          redirectUrl: null,
          provider: { id: "meituan", connected: false, mode: "MOCK_NO_PARTNERSHIP" },
          message: `已记录“${option.placeName}”的模拟跳转意向；不会实际打开美团或产生订单。`
        };
      }
    }
  };
}
