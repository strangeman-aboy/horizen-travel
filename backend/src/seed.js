export const seedPlaces = [
  {
    id: "place-lama-temple",
    name: "雍和宫",
    address: "北京市东城区雍和宫大街12号",
    city: "北京",
    category: "古建与祈福",
    lat: 39.953377859,
    lng: 116.42370918,
    coordSystem: "BD09LL",
    coordinateSource: "VERIFIED_BAIDU_GEOCODE_ANCHOR",
    imageUrl: "/assets/beijing-lama-temple.png",
    note: "把人流较少的清晨留给雍和宫，让一天从更安静的节奏开始。"
  },
  {
    id: "place-wudaoying",
    name: "五道营胡同",
    address: "北京市东城区五道营胡同",
    city: "北京",
    category: "咖啡与早午餐",
    lat: 39.954949461,
    lng: 116.415124973,
    coordSystem: "BD09LL",
    coordinateSource: "VERIFIED_BAIDU_GEOCODE_ANCHOR",
    imageUrl: "/assets/beijing-wudaoying.png",
    note: "早午餐、咖啡和独立小店集中在同一条胡同，给上午留出弹性。"
  },
  {
    id: "place-guozijian",
    name: "国子监街",
    address: "北京市东城区国子监街",
    city: "北京",
    category: "古建与街巷",
    lat: 39.951771858,
    lng: 116.418891837,
    coordSystem: "BD09LL",
    coordinateSource: "VERIFIED_BAIDU_GEOCODE_ANCHOR",
    imageUrl: "/assets/beijing-guozijian.png",
    note: "沿灰砖红门慢慢走完国子监街，把牌楼、院落与街区日常放在同一段步行里。"
  },
  {
    id: "place-dongsi-art",
    name: "东四艺文街区",
    address: "北京市东城区东四片区",
    city: "北京",
    category: "当代艺术",
    lat: 39.92988923,
    lng: 116.416619483,
    coordSystem: "BD09LL",
    coordinateSource: "VERIFIED_BAIDU_GEOCODE_ANCHOR",
    imageUrl: "/assets/beijing-guardian-art.png",
    note: "下午进入东四一带艺文空间看展；具体展讯需在出发前再次核验。"
  },
  {
    id: "place-jingshan",
    name: "景山公园",
    address: "北京市西城区景山西街44号",
    city: "北京",
    category: "中轴线日落",
    lat: 39.93227005,
    lng: 116.402818007,
    coordSystem: "BD09LL",
    coordinateSource: "VERIFIED_BAIDU_GEOCODE_ANCHOR",
    imageUrl: "/assets/beijing-jingshan.png",
    note: "把傍晚留给景山，从高处看北京中轴线；日落时间需要当天核验。"
  },
  {
    id: "place-shichahai",
    name: "什刹海",
    address: "北京市西城区什刹海街道",
    city: "北京",
    category: "湖畔夜色",
    lat: 39.94223553,
    lng: 116.397197669,
    coordSystem: "BD09LL",
    coordinateSource: "VERIFIED_BAIDU_GEOCODE_ANCHOR",
    imageUrl: "/assets/beijing-shichahai.png",
    note: "沿湖散步和吃晚饭作为自然收尾，不再塞入新的远距离景点。"
  },
  {
    id: "place-forbidden-city",
    name: "故宫博物院",
    address: "北京市东城区景山前街4号",
    city: "北京",
    category: "宫城与中轴线",
    lat: 39.924091,
    lng: 116.403414,
    coordSystem: "BD09LL",
    coordinateSource: "VERIFIED_BAIDU_GEOCODE_ANCHOR",
    imageUrl: "/assets/beijing-forbidden-city-dashboard.png",
    note: "需要提前预约；动态开放和票务信息必须在官方渠道再次核验。"
  },
  {
    id: "place-bell-drum-towers",
    name: "钟鼓楼胡同",
    address: "北京市东城区钟楼湾胡同临字9号",
    city: "北京",
    category: "老城与街巷",
    lat: 39.946598,
    lng: 116.399153,
    coordSystem: "BD09LL",
    coordinateSource: "VERIFIED_BAIDU_GEOCODE_ANCHOR",
    imageUrl: "/assets/beijing-hero-hutong.png",
    note: "从鼓楼周边慢慢走进旧城胡同，适合衔接什刹海。"
  }
];

export const seedRoutes = [
  {
    id: "route-beijing-hutong-art",
    versionId: "route-version-beijing-hutong-art-v1",
    title: "北京胡同与艺文一日",
    city: "北京",
    timezone: "Asia/Shanghai",
    summary: "从雍和宫与五道营出发，走过胡同、艺文空间和北京中轴线，把日落留给景山。",
    coverImageUrl: "/assets/beijing-hero-hutong.png",
    creator: {
      id: "creator-chen",
      name: "陈以欢",
      avatarUrl: "/assets/creator-chen.png"
    },
    sourceType: "PLANNED_EDITORIAL",
    stops: [
      {
        id: "route-stop-lama-temple",
        placeId: "place-lama-temple",
        suggestedTime: "09:00",
        durationMinutes: 75,
        note: "清晨先看红墙金瓦。",
        locked: false
      },
      {
        id: "route-stop-wudaoying",
        placeId: "place-wudaoying",
        suggestedTime: "10:30",
        durationMinutes: 90,
        note: "胡同早午餐与独立小店。",
        locked: false
      },
      {
        id: "route-stop-guozijian",
        placeId: "place-guozijian",
        suggestedTime: "12:15",
        durationMinutes: 60,
        note: "灰砖红门的古建街区。",
        locked: false
      },
      {
        id: "route-stop-dongsi-art",
        placeId: "place-dongsi-art",
        suggestedTime: "14:30",
        durationMinutes: 90,
        note: "14:30 固定预约示例。",
        locked: true
      },
      {
        id: "route-stop-jingshan",
        placeId: "place-jingshan",
        suggestedTime: "16:45",
        durationMinutes: 80,
        note: "傍晚登高看中轴线。",
        locked: false
      },
      {
        id: "route-stop-shichahai",
        placeId: "place-shichahai",
        suggestedTime: "18:45",
        durationMinutes: 90,
        note: "湖畔夜色与晚餐。",
        locked: false
      }
    ]
  }
];

export const xiaohongshuMockRouteId = "route-beijing-hutong-art";

export function getSeedPlace(placeId) {
  return seedPlaces.find((place) => place.id === placeId);
}

export function getSeedRoute(routeId) {
  return seedRoutes.find((route) => route.id === routeId);
}
