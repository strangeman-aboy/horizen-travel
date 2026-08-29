const freezeOption = (option) => Object.freeze({
  ...option,
  ...(option.weights ? { weights: Object.freeze({ ...option.weights }) } : {}),
});

const freezeQuestion = (question) => Object.freeze({
  ...question,
  options: Object.freeze(question.options.map(freezeOption)),
});

const freezePersona = (persona) => Object.freeze({
  ...persona,
  routePriors: Object.freeze([...persona.routePriors]),
});

const freezeRouteProfile = (route) => Object.freeze({
  ...route,
  goals: Object.freeze([...route.goals]),
  attractions: Object.freeze([...route.attractions]),
  aversions: Object.freeze([...route.aversions]),
  axisTargets: Object.freeze({ ...route.axisTargets }),
});

const profileOption = ({ id, label, axisId, code, oppositeCode, share }) => ({
  id,
  label,
  ...(axisId ? { axisId } : {}),
  code,
  weights: {
    [code]: share,
    [oppositeCode]: 100 - share,
  },
});

export const DIALECT_ASSESSMENT_CONFIG = Object.freeze({
  version: "v0.6.0",
  scoringVersion: "weighted-route-v1",
  startQuestionId: "t01-noodle",
  questionPoolCount: 18,
  personalityQuestionCount: 15,
  travelQuestionCount: 0,
  minimumAxisAnswers: 3,
  minQuestions: 15,
  maxQuestions: 15,
});

export const DIALECT_PERSONALITY_DIMENSIONS = Object.freeze([
  Object.freeze({
    id: "action",
    label: "行动启动",
    leftCode: "A",
    leftLabel: "先动起来",
    rightCode: "R",
    rightLabel: "想清再动",
    tieBreakCode: "R",
  }),
  Object.freeze({
    id: "novelty",
    label: "新奇取向",
    leftCode: "N",
    leftLabel: "偏爱尝鲜",
    rightCode: "F",
    rightLabel: "偏爱熟悉",
    tieBreakCode: "F",
  }),
  Object.freeze({
    id: "social",
    label: "社交加工",
    leftCode: "G",
    leftLabel: "边聊边想",
    rightCode: "S",
    rightLabel: "独处想清",
    tieBreakCode: "S",
  }),
  Object.freeze({
    id: "structure",
    label: "结构偏好",
    leftCode: "P",
    leftLabel: "先定框架",
    rightCode: "W",
    rightLabel: "现场调整",
    tieBreakCode: "W",
  }),
]);

export const DIALECT_TRAVEL_LABELS = Object.freeze({
  goals: Object.freeze({
    NOV: "探索",
    RST: "复原",
    LOC: "连接",
    EXP: "表达",
  }),
  goalDetails: Object.freeze({
    NOV: "撞见一个没见过的新世界",
    RST: "把自己充回满格",
    LOC: "带回一段有名字的故事",
    EXP: "留下一份只有自己有的作品",
  }),
  attractions: Object.freeze({
    NAT: "山野大景",
    HID: "隐藏发现",
    LIFE: "在地生活",
    ICON: "经典高光",
  }),
  aversions: Object.freeze({
    RUSH: "讨厌赶路",
    BORING: "讨厌平庸",
    LONELY: "讨厌无连接",
    CHAOS: "讨厌失控",
  }),
});

export const DIALECT_ROUTE_SCORING = Object.freeze({
  primaryPriorBase: 1,
  primaryPriorIntensityBonus: 12,
  secondaryPriorBase: 5.5,
  secondaryPriorIntensityAdjustment: -1.5,
  attractionMatch: 7,
  goalMatch: 4,
  aversionMatch: 2,
  axisFitMaximum: 6,
});

const lifeQuestion = ({ id, axisId, eyebrow, prompt, symbol, transition, options }) => (
  freezeQuestion({
    id,
    stage: "profile",
    ...(axisId ? { axisId } : {}),
    eyebrow,
    prompt,
    symbol,
    transition,
    options,
  })
);

export const DIALECT_PERSONALITY_QUESTIONS = Object.freeze([
  lifeQuestion({
    id: "t01-noodle",
    axisId: "novelty",
    eyebrow: "鲜 / 熟 · 🍜 一碗面",
    prompt: "一碗面摆在面前，你是：",
    symbol: "🍜",
    options: [
      profileOption({ id: "F", label: "选自己最爱的红烧/牛肉味，稳", code: "F", oppositeCode: "N", share: 76 }),
      profileOption({ id: "N", label: "先喝一口没喝过的汤底，哪怕可能踩雷", code: "N", oppositeCode: "F", share: 84 }),
    ],
  }),
  lifeQuestion({
    id: "t02-photo-queue",
    axisId: "structure",
    eyebrow: "盘 / 飘 · 📸 经典机位",
    prompt: "到了一个经典机位，前面排了二十个人，你会：",
    symbol: "📸",
    options: [
      profileOption({ id: "W", label: "随便在旁边拍一张走人，不差这一个点", code: "W", oppositeCode: "P", share: 78 }),
      profileOption({ id: "P", label: "排着，来都来了，必须按计划拿下这张照", code: "P", oppositeCode: "W", share: 88 }),
    ],
  }),
  lifeQuestion({
    id: "t03-closed-path",
    axisId: "action",
    eyebrow: "冲 / 磨 · 🗺️ 岔路路牌",
    prompt: "逛景点时看到一条岔路，路牌写着“此路不通”：",
    symbol: "🗺️",
    options: [
      profileOption({ id: "R", label: "拍个路牌就走了，没必要浪费时间", code: "R", oppositeCode: "A", share: 82 }),
      profileOption({ id: "A", label: "反而想进去看看不通到哪", code: "A", oppositeCode: "R", share: 86 }),
    ],
  }),
  lifeQuestion({
    id: "t04-lost-street",
    axisId: "social",
    eyebrow: "凑 / 独 · 🚶 陌生街头",
    prompt: "在陌生城市街头迷路了，你会：",
    symbol: "🚶",
    options: [
      profileOption({ id: "S", label: "自己对着地图慢慢找，不想麻烦别人", code: "S", oppositeCode: "G", share: 84 }),
      profileOption({ id: "G", label: "逮着路人就问，顺便聊两句本地生活", code: "G", oppositeCode: "S", share: 80 }),
    ],
  }),
  lifeQuestion({
    id: "t05-alien-luggage",
    eyebrow: "四选一 · 🧳 三分钟逃命",
    prompt: "外星人入侵地球，只给你三分钟收拾行李逃命，你的状态是：",
    symbol: "🧳",
    options: [
      profileOption({ id: "P", label: "快速列一个优先级清单再执行", axisId: "structure", code: "P", oppositeCode: "W", share: 92 }),
      profileOption({ id: "W", label: "🔥 坐下来给外星人写一封欢迎信，毕竟来者是客", axisId: "structure", code: "W", oppositeCode: "P", share: 88 }),
      profileOption({ id: "A", label: "抓起护照手机钱包就跑", axisId: "action", code: "A", oppositeCode: "R", share: 90 }),
      profileOption({ id: "R", label: "花三分钟想“什么东西必须带”", axisId: "action", code: "R", oppositeCode: "A", share: 86 }),
    ],
  }),
  lifeQuestion({
    id: "t06-unknown-menu",
    axisId: "novelty",
    eyebrow: "鲜 / 熟 · 🥘 陌生菜单",
    prompt: "朋友推荐一家餐厅，但你看了菜单发现全是没吃过的食材：",
    symbol: "🥘",
    options: [
      profileOption({ id: "F", label: "点看着最像家常菜的那个", code: "F", oppositeCode: "N", share: 80 }),
      profileOption({ id: "N", label: "点最不认识的那道，来都来了", code: "N", oppositeCode: "F", share: 82 }),
    ],
  }),
  lifeQuestion({
    id: "t07-suite-upgrade",
    axisId: "structure",
    eyebrow: "盘 / 飘 · 🛏️ 房型升级",
    prompt: "到酒店发现房型被升级成超大套房，你会：",
    symbol: "🛏️",
    options: [
      profileOption({ id: "W", label: "哇一声，然后就随便用了", code: "W", oppositeCode: "P", share: 74 }),
      profileOption({ id: "P", label: "立刻规划：这个沙发可以躺，那个桌子可以办公", code: "P", oppositeCode: "W", share: 90 }),
    ],
  }),
  lifeQuestion({
    id: "t08-strange-icecream",
    axisId: "novelty",
    eyebrow: "鲜 / 熟 · 🍦 奇怪口味",
    prompt: "遇到一个卖奇怪口味冰淇淋的摊位（比如酱油味），你会：",
    symbol: "🍦",
    options: [
      profileOption({ id: "F", label: "买旁边的香草味，安全", code: "F", oppositeCode: "N", share: 88 }),
      profileOption({ id: "N", label: "买！就试一口", code: "N", oppositeCode: "F", share: 90 }),
    ],
  }),
  lifeQuestion({
    id: "t09-night-before",
    axisId: "action",
    eyebrow: "冲 / 磨 · 🎒 出发前夜",
    prompt: "出发前夜，你躺在床上：",
    symbol: "🎒",
    options: [
      profileOption({ id: "R", label: "脑子里过了一遍所有“万一出事咋办”", code: "R", oppositeCode: "A", share: 84 }),
      profileOption({ id: "A", label: "兴奋得睡不着，恨不得半夜就出发", code: "A", oppositeCode: "R", share: 92 }),
    ],
  }),
  lifeQuestion({
    id: "t10-wrong-takeout",
    eyebrow: "四选一 · 🍕 外卖错单",
    prompt: "你点了一份外卖，结果送来了完全不是自己点的那份，但看起来也挺好吃：",
    symbol: "🍕",
    options: [
      profileOption({ id: "R", label: "🔥 开始怀疑“我点的真的是我想要的吗？还是外卖替我做了选择？”", axisId: "action", code: "R", oppositeCode: "A", share: 90 }),
      profileOption({ id: "F", label: "打电话要求换回自己点的", axisId: "novelty", code: "F", oppositeCode: "N", share: 86 }),
      profileOption({ id: "W", label: "拍了张照发朋友圈再吃", axisId: "structure", code: "W", oppositeCode: "P", share: 84 }),
      profileOption({ id: "N", label: "吃了，新世界的大门打开了", axisId: "novelty", code: "N", oppositeCode: "F", share: 94 }),
    ],
  }),
  lifeQuestion({
    id: "t11-night-market-table",
    axisId: "social",
    eyebrow: "凑 / 独 · 🍻 夜市拼桌",
    prompt: "到夜市发现所有座位都拼桌，你会：",
    symbol: "🍻",
    options: [
      profileOption({ id: "S", label: "打包带走，回酒店自己慢慢吃", code: "S", oppositeCode: "G", share: 86 }),
      profileOption({ id: "G", label: "直接坐下去，跟对面大哥开聊“这啥好吃”", code: "G", oppositeCode: "S", share: 90 }),
    ],
  }),
  lifeQuestion({
    id: "t12-navigation-signal",
    axisId: "action",
    eyebrow: "冲 / 磨 · 🚗 导航失联",
    prompt: "导航突然没信号了，你会：",
    symbol: "🚗",
    options: [
      profileOption({ id: "R", label: "靠边停车，把离线地图和路牌研究透再动", code: "R", oppositeCode: "A", share: 92 }),
      profileOption({ id: "A", label: "凭直觉先朝一个方向开，到有信号的地方再说", code: "A", oppositeCode: "R", share: 82 }),
    ],
  }),
  lifeQuestion({
    id: "t13-long-ride",
    axisId: "social",
    eyebrow: "凑 / 独 · 🎧 长途路上",
    prompt: "长途交通工具上你更常：",
    symbol: "🎧",
    options: [
      profileOption({ id: "S", label: "戴耳机沉浸在自己的播客/音乐里", code: "S", oppositeCode: "G", share: 80 }),
      profileOption({ id: "G", label: "跟邻座聊起来，交换各自的旅行故事", code: "G", oppositeCode: "S", share: 88 }),
    ],
  }),
  lifeQuestion({
    id: "t14-one-toothbrush",
    eyebrow: "四选一 · 🦷 一支牙刷",
    prompt: "到了酒店发现牙刷只有一支，但你有两个人，你第一反应是：",
    symbol: "🦷",
    options: [
      profileOption({ id: "S", label: "🔥 思考“为什么‘我’和‘你’需要两支牙刷？我们真的存在吗？”", axisId: "social", code: "S", oppositeCode: "G", share: 92 }),
      profileOption({ id: "A", label: "先抢到手再说，用行动解决问题", axisId: "action", code: "A", oppositeCode: "R", share: 90 }),
      profileOption({ id: "G", label: "跟对方商量“要不咱俩掰开用？”", axisId: "social", code: "G", oppositeCode: "S", share: 84 }),
      profileOption({ id: "R", label: "打电话问前台再要一支，按流程来", axisId: "action", code: "R", oppositeCode: "A", share: 88 }),
    ],
  }),
  lifeQuestion({
    id: "t15-expense-review",
    axisId: "structure",
    eyebrow: "盘 / 飘 · 📝 花费复盘",
    prompt: "旅行最后一天复盘花费，你会发现：",
    symbol: "📝",
    options: [
      profileOption({ id: "W", label: "完全不知道钱花哪了，但玩得挺爽", code: "W", oppositeCode: "P", share: 90 }),
      profileOption({ id: "P", label: "每一笔都记得清清楚楚，跟预算差不多", code: "P", oppositeCode: "W", share: 94 }),
    ],
  }),
  lifeQuestion({
    id: "t16-rainstorm",
    axisId: "action",
    eyebrow: "冲 / 磨 · 🌧️ 暴雨改道",
    prompt: "旅行第三天突然下暴雨，原计划的户外行程泡汤，你会：",
    symbol: "🌧️",
    options: [
      profileOption({ id: "R", label: "先躺平刷一小时手机，看看雨势再说", code: "R", oppositeCode: "A", share: 76 }),
      profileOption({ id: "A", label: "立刻搜室内替代方案，说走就走", code: "A", oppositeCode: "R", share: 88 }),
    ],
  }),
  lifeQuestion({
    id: "t17-local-supermarket",
    axisId: "novelty",
    eyebrow: "鲜 / 熟 · 🛍️ 当地超市",
    prompt: "逛当地超市，你更可能：",
    symbol: "🛍️",
    options: [
      profileOption({ id: "F", label: "买认识的大牌，至少知道是啥味", code: "F", oppositeCode: "N", share: 82 }),
      profileOption({ id: "N", label: "买完全没见过包装的零食，图新鲜", code: "N", oppositeCode: "F", share: 86 }),
    ],
  }),
  lifeQuestion({
    id: "t18-missed-stop",
    axisId: "action",
    eyebrow: "冲 / 磨 · 🚌 坐过站",
    prompt: "坐过站了，你会：",
    symbol: "🚌",
    options: [
      profileOption({ id: "R", label: "立刻下车过马路坐回去，不偏离计划", code: "R", oppositeCode: "A", share: 94 }),
      profileOption({ id: "A", label: "将错就错，在新的地方逛逛", code: "A", oppositeCode: "R", share: 84 }),
    ],
  }),
]);

const SOURCE_URLS = Object.freeze({
  groupA: "https://www.yuncunzhai.com/book/247967.jhtml",
  playful: "https://www.yuncunzhai.com/book/247940.jhtml",
  impatient: "https://www.yuncunzhai.com/book/248439.jhtml",
  mischievous: "https://www.yuncunzhai.com/book/248704.jhtml",
  capable: "https://www.yuncunzhai.com/book/248099.jhtml",
  lively: "https://movement.gzstv.com/news/detail/HxaJje/",
  jWords: "https://www.yuncunzhai.com/book/248201.jhtml",
  xWords: "https://www.yuncunzhai.com/book/249008.jhtml",
  easy: "https://www.yuncunzhai.com/book/248665.jhtml",
  sincere: "https://www.yuncunzhai.com/book/247542.jhtml",
  amazed: "https://movement.gzstv.com/news/detail/HNjM2R/",
  unusual: "https://www.yuncunzhai.com/book/212392.jhtml",
  serious: "https://www.yuncunzhai.com/book/249178.jhtml",
  wander: "https://www.yuncunzhai.com/book/248327.jhtml",
});

export const DIALECT_PERSONALITIES = Object.freeze([
  freezePersona({
    id: "angp-gandoucou",
    code: "ANGP",
    name: "赶斗凑型",
    dialectName: "赶斗凑",
    archetype: "现场发动机",
    tagline: "哪点有现场，哪点就差你一个。",
    description: "你习惯先把人带进现场，再让新鲜体验真正发生。活动越真实、大家越投入，你越来劲。",
    dialectMeaning: "凑热闹、赶去参与。这里取主动进入现场、带动共同体验的意思。",
    riskLevel: "低",
    sourceUrl: SOURCE_URLS.groupA,
    audioSrc: null,
    audioText: "赶斗凑",
    pronunciationText: "gan³ dou⁴ cou⁴",
    routePriors: ["qiandongnan-miao-towns", "anshun-waterfall-caves"],
    routeReason: "现场密度高、参与方式清楚，还能把同行的人一起带进贵州的热闹里。",
  }),
  freezePersona({
    id: "angw-fengdeqi",
    code: "ANGW",
    name: "疯叉叉",
    dialectName: "疯叉叉",
    archetype: "山野撒欢客",
    previewTravelType: "山野撒欢",
    tagline: "别人问值不值，你先问能不能玩大点。",
    description: "你玩得开，也敢试新东西。路线有个大方向就够了，真正的惊喜最好留给现场。",
    dialectMeaning: "与“疯得很”“疯得起”同义，也可形容没有梳理装扮。这里取活泼欢快、不受约束、敢放开玩的意思。",
    riskLevel: "中低",
    sourceUrl: SOURCE_URLS.playful,
    audioSrc: null,
    audioText: "疯叉叉",
    pronunciationText: "fong¹ ca¹ ca¹",
    routePriors: ["wanfenglin-canyon", "qiandongnan-miao-towns"],
    routeReason: "新体验够密，岔路也够多，同行的人随时能把计划玩出一个意外版本。",
  }),
  freezePersona({
    id: "ansp-gaodeying",
    code: "ANSP",
    name: "鬼火戳型",
    dialectName: "鬼火戳",
    archetype: "高效攻坚手",
    previewTravelType: "高效攻坚",
    tagline: "路可以远，时间不能浪费。",
    description: "你会独立把目标往前推，也愿意为新鲜高光投入体力。真正让你冒火的是无效等待和绕路。",
    dialectMeaning: "贵阳话里形容非常生气。这里取对无效等待、反复绕路和错过高光格外没有耐心的旅行节奏。",
    riskLevel: "低",
    sourceUrl: SOURCE_URLS.unusual,
    audioSrc: null,
    audioText: "鬼火戳",
    pronunciationText: null,
    routePriors: ["fanjingshan-tongren", "anshun-waterfall-caves"],
    routeReason: "核心高光明确、转场能控制，适合自己把一场高投入旅行利落推进。",
  }),
  freezePersona({
    id: "answ-qianfan",
    code: "ANSW",
    name: "千翻型",
    dialectName: "千翻",
    archetype: "岔路捣蛋王",
    tagline: "攻略给你一条路，你非要从旁边再长一条。",
    description: "你爱折腾，也爱计划外发现。标准路线可以有，但它必须允许你临时拐进一条有意思的岔路。",
    dialectMeaning: "顽皮好动、不安分、爱折腾。这里取爱变化、爱发现的轻松自嘲。",
    riskLevel: "中",
    sourceUrl: SOURCE_URLS.mischievous,
    audioSrc: null,
    audioText: "千翻",
    pronunciationText: "qian¹ fan¹",
    routePriors: ["wanfenglin-canyon", "dong-villages-terraces"],
    routeReason: "宝藏点和自由岔路都留着，远一点也没关系，只要返程边界清楚。",
  }),
  freezePersona({
    id: "afgp-hadekai",
    code: "AFGP",
    name: "哈得开型",
    dialectName: "哈得开",
    archetype: "全场主理人",
    tagline: "别人带行李，你带解决办法。",
    description: "你擅长把人和资源组织起来，也更相信可靠顺当的路线。大家玩得舒服，你就有成就感。",
    dialectMeaning: "有本事、有能力、吃得开。这里取能组织资源、能把事情办顺的意思。",
    riskLevel: "低",
    sourceUrl: SOURCE_URLS.capable,
    audioSrc: null,
    audioText: "哈得开",
    pronunciationText: "ha¹ de² kai¹",
    routePriors: ["anshun-waterfall-caves", "qiandongnan-miao-towns"],
    routeReason: "交通、预订和多人参与都更稳，既能照顾全队，也不会错过贵州高光。",
  }),
  freezePersona({
    id: "afgw-xihadaxiao",
    code: "AFGW",
    name: "嘻哈打笑型",
    dialectName: "嘻哈打笑",
    archetype: "热闹气氛组",
    tagline: "景点还没到，车上已经被你整成主会场。",
    description: "熟人同行最能给你充电。路线不用排得太死，哪里热闹、哪里有人情味，你就往哪里靠。",
    dialectMeaning: "嘻嘻哈哈、打打闹闹。这里取熟人同行时放得开、能把气氛带起来的意思。",
    riskLevel: "低",
    sourceUrl: SOURCE_URLS.xWords,
    audioSrc: null,
    audioText: "嘻哈打笑",
    pronunciationText: "xi¹ ha¹ da³ xiao⁴",
    routePriors: ["qiandongnan-miao-towns", "guiyang-heritage-day"],
    routeReason: "熟人、烟火和夜色都在场，计划有弹性，热闹也不会被赶路打断。",
  }),
  freezePersona({
    id: "afsp-xianshuohoubuluan",
    code: "AFSP",
    name: "先说后不乱型",
    dialectName: "先说后不乱",
    archetype: "路线控场派",
    tagline: "出发前说清楚，路上就不跟混乱打架。",
    description: "你行动利落，也需要路线讲清楚。清楚计划让你保持效率，临时混乱最容易把情绪点着。",
    dialectMeaning: "事先把话讲清、把规矩定好，后面就不容易乱。很贴合你的路线控场感。",
    riskLevel: "低",
    sourceUrl: SOURCE_URLS.xWords,
    audioSrc: null,
    audioText: "先说后不乱",
    pronunciationText: "xian¹ so² hou⁴ bu² luan⁴",
    routePriors: ["anshun-waterfall-caves", "zunyi-history-danxia"],
    routeReason: "时间节点、备用路线和核心看点都清楚，旅行不必靠临场救火。",
  }),
  freezePersona({
    id: "afsw-pietuo",
    code: "AFSW",
    name: "撇脱型",
    dialectName: "撇脱",
    archetype: "省心行动派",
    tagline: "能一步走通的路，绝不陪它绕三圈。",
    description: "你喜欢干脆、省心的旅行。路线可以自由一点，但流程别复杂，走得顺比花样多更重要。",
    dialectMeaning: "干脆、顺当、方便。这里取不拖泥带水、追求省心顺路的意思。",
    riskLevel: "低",
    sourceUrl: SOURCE_URLS.easy,
    audioSrc: null,
    audioText: "撇脱",
    pronunciationText: "pie² to²",
    routePriors: ["libo-water-villages", "guiyang-heritage-day"],
    routeReason: "换乘少、操作少，到了现场还能按心情多停一会儿，说走就走也不费劲。",
  }),
  freezePersona({
    id: "rngp-baxinbayi",
    code: "RNGP",
    name: "巴心巴意型",
    dialectName: "巴心巴意",
    archetype: "深度关系策展人",
    tagline: "别人到此一游，你到此交心。",
    description: "你愿意先理解一个地方，再认真参与进去。人与地方之间真实的关系，比打卡数量更重要。",
    dialectMeaning: "真心真意、诚心诚意、一心一意。这里取认真理解人与地方的意思。",
    riskLevel: "低",
    sourceUrl: SOURCE_URLS.sincere,
    audioSrc: null,
    audioText: "巴心巴意",
    pronunciationText: "ba¹ xin¹ ba¹ yi⁴",
    routePriors: ["dong-villages-terraces", "guiyang-heritage-day"],
    routeReason: "文化脉络和共同参与都够深，提前约好关键体验后，就能慢慢和地方交心。",
  }),
  freezePersona({
    id: "rngw-tianpusa",
    code: "RNGW",
    name: "天菩萨型",
    dialectName: "天菩萨",
    archetype: "奇遇共鸣家",
    previewTravelType: "奇遇共鸣",
    tagline: "一趟路上能喊三次“天菩萨”才算值。",
    description: "你容易被反预期的场景击中，也喜欢把惊叹分享给同行的人。路线得给偶遇留一点位置。",
    dialectMeaning: "贵州口语里的惊叹表达，可表示惊讶、惊喜或惊恐。这里取被意外场景击中的惊喜。",
    riskLevel: "中",
    sourceUrl: SOURCE_URLS.amazed,
    audioSrc: null,
    audioText: "天菩萨",
    pronunciationText: null,
    routePriors: ["anshun-waterfall-caves", "libo-water-villages"],
    routeReason: "反预期山水和同行共鸣都够强，路线有弹性，也有能带回去讲的故事。",
  }),
  freezePersona({
    id: "rnsp-xiaxi",
    code: "RNSP",
    name: "下细型",
    dialectName: "下细",
    archetype: "私藏观察员",
    tagline: "大家排队打卡，你已经下细找到另一个角度。",
    description: "你会安静做好准备，再去找属于自己的观看位置。人少一点、视角特别一点，体验就会更深。",
    dialectMeaning: "做事认真仔细。这里取提前准备、安静观察，不漏掉细节的意思。",
    riskLevel: "低",
    sourceUrl: SOURCE_URLS.xWords,
    audioSrc: null,
    audioText: "下细",
    pronunciationText: "xia⁴ xi⁴",
    routePriors: ["dong-villages-terraces", "libo-water-villages"],
    routeReason: "安静时段和个人视角更充足，提前避开高峰后，贵州会露出更细的那一面。",
  }),
  freezePersona({
    id: "rnsw-jianzidazi",
    code: "RNSW",
    name: "见子打子型",
    dialectName: "见子打子",
    archetype: "怪路漫游者",
    tagline: "别人找攻略，你专门找攻略没写的怪东西。",
    description: "你不按常理选点，也喜欢独自消化那些奇怪又意外的发现。路线越有旁支，你越容易上头。",
    dialectMeaning: "根据眼前不同情况随机应变。这里取不按死攻略走、会顺着现场长出新路线的意思。",
    riskLevel: "低",
    sourceUrl: SOURCE_URLS.jWords,
    audioSrc: null,
    audioText: "见子打子",
    pronunciationText: "jian⁴ zi³ da³ zi³",
    routePriors: ["wanfenglin-canyon", "dong-villages-terraces"],
    routeReason: "非常规点位和独立漫游感都更强，同时保留清楚的安全与返程边界。",
  }),
  freezePersona({
    id: "rfgp-guiguizuozuo",
    code: "RFGP",
    name: "规规作作型",
    dialectName: "规规作作",
    archetype: "稳妥总管",
    tagline: "你不是带队，你是在给全队托底。",
    description: "你会把大家的需要一起放进计划，也信任可靠、可复现的路线。稳稳当当就是你的旅行超能力。",
    dialectMeaning: "整整齐齐、妥妥当当。这里取可靠安排、照顾全局的意思。",
    riskLevel: "低",
    sourceUrl: SOURCE_URLS.groupA,
    audioSrc: null,
    audioText: "规规作作",
    pronunciationText: "gui¹ gui¹ zo² zo²",
    routePriors: ["zunyi-history-danxia", "anshun-waterfall-caves"],
    routeReason: "节奏稳定、风险较低，也能照顾多人需求，整条路线很容易被全队理解。",
  }),
  freezePersona({
    id: "rfgw-huohuohai",
    code: "RFGW",
    name: "活活嗨型",
    dialectName: "活活嗨",
    archetype: "松弛同路人",
    tagline: "景点漏一个没事，大家舒服最重要。",
    description: "你随和、好相处，也不想和行程较劲。熟悉可靠的底子加一点留白，就是最舒服的同行方式。",
    dialectMeaning: "随和乐观、容易相处，也可能带随意不靠谱的语气。这里取松弛、好相处的意思。",
    riskLevel: "中低",
    sourceUrl: SOURCE_URLS.capable,
    audioSrc: null,
    audioText: "活活嗨",
    pronunciationText: "ho² ho² hai¹",
    routePriors: ["libo-water-villages", "qiandongnan-miao-towns"],
    routeReason: "少转场、能自由停留，大家舒服地待在一起，比多收一个景点更重要。",
  }),
  freezePersona({
    id: "rfsp-zhengyizuoer",
    code: "RFSP",
    name: "正一作二型",
    dialectName: "正一作二",
    archetype: "严谨独行者",
    tagline: "路线没理顺之前，你的灵魂拒绝出发。",
    description: "你喜欢先把信息弄完整，再按可靠节奏独立推进。计划越清楚，到了现场越能安心看风景。",
    dialectMeaning: "与“正二八经”接近，表示一本正经。这里取认真规划、可靠执行的意思。",
    riskLevel: "低",
    sourceUrl: SOURCE_URLS.serious,
    audioSrc: null,
    audioText: "正一作二",
    pronunciationText: "zen⁴ yi² zo² er⁴",
    routePriors: ["zunyi-history-danxia", "anshun-waterfall-caves"],
    routeReason: "信息完整、计划明确，备用方案也好准备，适合按自己的可靠节奏走清楚。",
  }),
  freezePersona({
    id: "rfsw-nadianheinadianxie",
    code: "RFSW",
    name: "哪点黑哪点歇型",
    dialectName: "哪点黑哪点歇",
    archetype: "随遇而安客",
    tagline: "走到哪点黑，就在哪点把日子安顿好。",
    description: "你不赶、不争，也不需要把每段路塞满。走到哪里合适，就在哪里把当下过舒服。",
    dialectMeaning: "长途行走到哪里天黑，就在哪里住宿。这里取随遇而安、走到哪住到哪的意思。",
    riskLevel: "低",
    sourceUrl: SOURCE_URLS.wander,
    audioSrc: null,
    audioText: "哪点黑哪点歇",
    pronunciationText: "la³ dian³ he² la³ dian³ xie²",
    routePriors: ["guiyang-heritage-day", "dong-villages-terraces"],
    routeReason: "慢行、少锚点和足够停留最适合你，住宿与返程边界兜住后就能随遇而安。",
  }),
]);

export const DIALECT_ROUTE_PROFILES = Object.freeze([
  freezeRouteProfile({
    id: "guiyang-heritage-day",
    goals: ["LOC", "RST", "EXP"],
    attractions: ["LIFE", "HID", "ICON"],
    aversions: ["RUSH", "CHAOS"],
    axisTargets: { action: 42, novelty: 62, social: 40, structure: 68 },
  }),
  freezeRouteProfile({
    id: "anshun-waterfall-caves",
    goals: ["NOV", "EXP"],
    attractions: ["NAT", "ICON"],
    aversions: ["BORING", "LONELY"],
    axisTargets: { action: 64, novelty: 58, social: 58, structure: 76 },
  }),
  freezeRouteProfile({
    id: "qiandongnan-miao-towns",
    goals: ["LOC", "EXP"],
    attractions: ["LIFE", "ICON"],
    aversions: ["LONELY", "BORING"],
    axisTargets: { action: 58, novelty: 55, social: 82, structure: 38 },
  }),
  freezeRouteProfile({
    id: "libo-water-villages",
    goals: ["RST", "EXP"],
    attractions: ["NAT", "HID"],
    aversions: ["RUSH", "CHAOS"],
    axisTargets: { action: 38, novelty: 35, social: 32, structure: 36 },
  }),
  freezeRouteProfile({
    id: "wanfenglin-canyon",
    goals: ["NOV", "EXP"],
    attractions: ["NAT", "HID"],
    aversions: ["BORING", "LONELY"],
    axisTargets: { action: 86, novelty: 88, social: 38, structure: 28 },
  }),
  freezeRouteProfile({
    id: "zunyi-history-danxia",
    goals: ["LOC", "RST"],
    attractions: ["ICON", "LIFE"],
    aversions: ["CHAOS", "BORING"],
    axisTargets: { action: 35, novelty: 28, social: 44, structure: 84 },
  }),
  freezeRouteProfile({
    id: "dong-villages-terraces",
    goals: ["LOC", "RST"],
    attractions: ["LIFE", "HID"],
    aversions: ["RUSH", "LONELY"],
    axisTargets: { action: 42, novelty: 74, social: 28, structure: 58 },
  }),
  freezeRouteProfile({
    id: "fanjingshan-tongren",
    goals: ["NOV", "RST"],
    attractions: ["NAT", "ICON"],
    aversions: ["BORING", "CHAOS"],
    axisTargets: { action: 78, novelty: 84, social: 70, structure: 62 },
  }),
]);

const questionById = new Map(
  DIALECT_PERSONALITY_QUESTIONS.map((question) => [question.id, question]),
);

const defaultSessionQuestionIds = Object.freeze(
  DIALECT_PERSONALITY_QUESTIONS
    .slice(0, DIALECT_ASSESSMENT_CONFIG.maxQuestions)
    .map(({ id }) => id),
);

const shuffleWith = (items, random) => {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const drawn = Number(random());
    const normalized = Number.isFinite(drawn)
      ? Math.min(Math.max(drawn, 0), 0.999999999999)
      : 0;
    const swapIndex = Math.floor(normalized * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

export function createDialectQuestionSequence(random = Math.random, previousQuestionIds = []) {
  const selected = [];
  const selectedIds = new Set();

  for (const dimension of DIALECT_PERSONALITY_DIMENSIONS) {
    const dedicatedQuestions = shuffleWith(
      DIALECT_PERSONALITY_QUESTIONS.filter(({ axisId }) => axisId === dimension.id),
      random,
    ).slice(0, DIALECT_ASSESSMENT_CONFIG.minimumAxisAnswers);
    for (const question of dedicatedQuestions) {
      selected.push(question);
      selectedIds.add(question.id);
    }
  }

  const remainingCount = DIALECT_ASSESSMENT_CONFIG.maxQuestions - selected.length;
  const remainingQuestions = shuffleWith(
    DIALECT_PERSONALITY_QUESTIONS.filter(({ id }) => !selectedIds.has(id)),
    random,
  ).slice(0, remainingCount);

  const questionIds = shuffleWith([...selected, ...remainingQuestions], random)
    .map(({ id }) => id);
  if (
    questionIds.length > 1
    && questionIds.every((questionId, index) => questionId === previousQuestionIds[index])
  ) {
    return [...questionIds.slice(1), questionIds[0]];
  }
  return questionIds;
}

function normalizeSessionQuestionIds(questionIds) {
  if (!Array.isArray(questionIds)) return [...defaultSessionQuestionIds];
  const normalized = [];
  const seen = new Set();
  for (const rawQuestionId of questionIds) {
    const questionId = String(rawQuestionId);
    if (seen.has(questionId) || !questionById.has(questionId)) continue;
    seen.add(questionId);
    normalized.push(questionId);
  }
  if (normalized.length !== DIALECT_ASSESSMENT_CONFIG.maxQuestions) {
    return [...defaultSessionQuestionIds];
  }
  const hasMinimumAxisCoverage = DIALECT_PERSONALITY_DIMENSIONS.every((dimension) => (
    normalized.filter((questionId) => questionById.get(questionId)?.axisId === dimension.id)
      .length >= DIALECT_ASSESSMENT_CONFIG.minimumAxisAnswers
  ));
  if (!hasMinimumAxisCoverage) return [...defaultSessionQuestionIds];
  return normalized;
}

const personaByCode = new Map(
  DIALECT_PERSONALITIES.map((persona) => [persona.code, persona]),
);

function extractEntries(answers) {
  if (answers == null) return { entries: [], inputWasInvalid: false };
  if (answers instanceof Map) return { entries: [...answers.entries()], inputWasInvalid: false };
  if (Array.isArray(answers)) {
    return {
      entries: answers.map((answer) => (
        Array.isArray(answer)
          ? answer
          : [answer?.questionId ?? answer?.id, answer?.optionId ?? answer?.answerId]
      )),
      inputWasInvalid: false,
    };
  }
  if (typeof answers === "object") {
    return { entries: Object.entries(answers), inputWasInvalid: false };
  }
  return { entries: [], inputWasInvalid: true };
}

function normalizeDialectAnswers(answers) {
  const { entries, inputWasInvalid } = extractEntries(answers);
  const latestAnswers = new Map();
  const invalidAnswerIds = new Set();

  for (const [rawQuestionId, rawOptionId] of entries) {
    if (rawQuestionId == null) {
      invalidAnswerIds.add("unknown-question");
      continue;
    }
    latestAnswers.set(String(rawQuestionId), rawOptionId);
  }

  const validAnswers = new Map();
  for (const [questionId, optionId] of latestAnswers) {
    const question = questionById.get(questionId);
    const option = question?.options.find((candidate) => candidate.id === optionId);
    if (!question || !option) {
      invalidAnswerIds.add(questionId);
      continue;
    }
    validAnswers.set(questionId, { question, option });
  }

  return {
    validAnswers,
    invalidAnswerIds: [...invalidAnswerIds],
    inputWasInvalid,
  };
}
function scoreAxes(validAnswers) {
  const axisCounts = Object.fromEntries(
    DIALECT_PERSONALITY_DIMENSIONS.map((dimension) => [
      dimension.id,
      { [dimension.leftCode]: 0, [dimension.rightCode]: 0 },
    ]),
  );
  const axisWeights = Object.fromEntries(
    DIALECT_PERSONALITY_DIMENSIONS.map((dimension) => [
      dimension.id,
      { [dimension.leftCode]: 0, [dimension.rightCode]: 0 },
    ]),
  );

  for (const { question, option } of validAnswers.values()) {
    if (question.stage !== "profile") continue;
    const axisId = option.axisId ?? question.axisId;
    const dimension = DIALECT_PERSONALITY_DIMENSIONS
      .find(({ id }) => id === axisId);
    if (!dimension) continue;
    if (![dimension.leftCode, dimension.rightCode].includes(option.code)) continue;
    axisCounts[dimension.id][option.code] += 1;
    const fallbackWeights = {
      [option.code]: 100,
      [option.code === dimension.leftCode ? dimension.rightCode : dimension.leftCode]: 0,
    };
    const weights = option.weights ?? fallbackWeights;
    for (const code of [dimension.leftCode, dimension.rightCode]) {
      const contribution = Number(weights[code]);
      if (Number.isFinite(contribution) && contribution >= 0) {
        axisWeights[dimension.id][code] += contribution;
      }
    }
  }

  const traitCodes = {};
  const traitLabels = {};
  const dimensionResults = [];
  for (const dimension of DIALECT_PERSONALITY_DIMENSIONS) {
    const counts = axisCounts[dimension.id];
    const answered = counts[dimension.leftCode] + counts[dimension.rightCode];
    const weights = axisWeights[dimension.id];
    const totalWeight = weights[dimension.leftCode] + weights[dimension.rightCode];
    const leftPercentage = totalWeight > 0
      ? Math.round((weights[dimension.leftCode] / totalWeight) * 100)
      : null;
    const rightPercentage = leftPercentage == null ? null : 100 - leftPercentage;
    const code = totalWeight > 0 && weights[dimension.leftCode] > weights[dimension.rightCode]
      ? dimension.leftCode
      : dimension.tieBreakCode;
    const selectedPercentage = leftPercentage == null
      ? null
      : Math.max(leftPercentage, rightPercentage);
    const selectedLabel = code === dimension.leftCode
      ? dimension.leftLabel
      : dimension.rightLabel;
    const isComplete = answered >= DIALECT_ASSESSMENT_CONFIG.minimumAxisAnswers;
    const strengthLabel = selectedPercentage == null
      ? "待作答"
      : selectedPercentage >= 85
        ? "鲜明"
        : selectedPercentage >= 70
          ? "明显"
          : selectedPercentage >= 58
            ? "略偏"
            : "接近均衡";

    dimensionResults.push({
      id: dimension.id,
      label: dimension.label,
      leftCode: dimension.leftCode,
      leftLabel: dimension.leftLabel,
      rightCode: dimension.rightCode,
      rightLabel: dimension.rightLabel,
      leftPercentage,
      rightPercentage,
      selectedCode: isComplete ? code : null,
      selectedLabel: isComplete ? selectedLabel : null,
      selectedPercentage: isComplete ? selectedPercentage : null,
      strengthLabel: isComplete ? strengthLabel : "待作答",
      answeredCount: answered,
      isComplete,
    });

    if (!isComplete) continue;
    traitCodes[dimension.id] = code;
    traitLabels[dimension.id] = selectedLabel;
  }

  const personalityCode = DIALECT_PERSONALITY_DIMENSIONS
    .map((dimension) => traitCodes[dimension.id] ?? "")
    .join("");

  const completedDimensions = dimensionResults.filter(({ isComplete }) => isComplete);
  const profileStrengthPercentage = completedDimensions.length > 0
    ? Math.round(
      completedDimensions.reduce((sum, dimension) => (
        sum + dimension.selectedPercentage
      ), 0) / completedDimensions.length,
    )
    : null;
  const profileIntensity = profileStrengthPercentage == null
    ? 0
    : Math.max(0, Math.min(1, (profileStrengthPercentage - 50) / 50));
  const dominantDimension = completedDimensions.reduce((strongest, dimension) => (
    !strongest || dimension.selectedPercentage > strongest.selectedPercentage
      ? dimension
      : strongest
  ), null);
  const profileKey = completedDimensions.length === DIALECT_PERSONALITY_DIMENSIONS.length
    ? completedDimensions
      .map(({ selectedCode, selectedPercentage }) => `${selectedCode}${selectedPercentage}`)
      .join("-")
    : null;

  return {
    axisCounts,
    axisWeights,
    dimensionResults,
    traitCodes,
    traitLabels,
    personalityCode,
    profileStrengthPercentage,
    profileIntensity,
    dominantDimension,
    profileKey,
  };
}

function deriveTravelVariant(scoring) {
  const dimensions = Object.fromEntries(
    scoring.dimensionResults.map((dimension) => [dimension.id, dimension]),
  );
  const action = dimensions.action?.leftPercentage ?? 50;
  const novelty = dimensions.novelty?.leftPercentage ?? 50;
  const social = dimensions.social?.leftPercentage ?? 50;
  const structure = dimensions.structure?.leftPercentage ?? 50;

  const goal = novelty >= 65
    ? "NOV"
    : social >= 62
      ? "LOC"
      : structure >= 62
        ? "EXP"
        : "RST";
  const attraction = novelty >= 70 && action >= 55
    ? "NAT"
    : social >= 60
      ? "LIFE"
      : novelty >= 56
        ? "HID"
        : "ICON";
  const aversion = structure >= 62
    ? "CHAOS"
    : novelty >= 62
      ? "BORING"
      : social >= 58
        ? "LONELY"
        : "RUSH";

  return { goal, attraction, aversion };
}

function rankRoutes(personality, variant, scoring) {
  const intensity = scoring.profileIntensity ?? 0;
  return DIALECT_ROUTE_PROFILES
    .map((route, index) => {
      const priorIndex = personality.routePriors.indexOf(route.id);
      const priorScore = priorIndex === 0
        ? DIALECT_ROUTE_SCORING.primaryPriorBase
          + (DIALECT_ROUTE_SCORING.primaryPriorIntensityBonus * intensity)
        : priorIndex === 1
          ? DIALECT_ROUTE_SCORING.secondaryPriorBase
            + (DIALECT_ROUTE_SCORING.secondaryPriorIntensityAdjustment * intensity)
          : 0;
      const travelScore = (
        (route.attractions.includes(variant.attraction)
          ? DIALECT_ROUTE_SCORING.attractionMatch
          : 0)
        + (route.goals.includes(variant.goal) ? DIALECT_ROUTE_SCORING.goalMatch : 0)
        + (route.aversions.includes(variant.aversion)
          ? DIALECT_ROUTE_SCORING.aversionMatch
          : 0)
      );
      const completedDimensions = scoring.dimensionResults
        .filter(({ leftPercentage }) => leftPercentage != null);
      const axisFitScore = completedDimensions.length > 0
        ? completedDimensions.reduce((sum, dimension) => {
          const target = route.axisTargets[dimension.id];
          const closeness = Number.isFinite(target)
            ? 1 - (Math.abs(dimension.leftPercentage - target) / 100)
            : 0;
          return sum + Math.max(0, closeness);
        }, 0) / completedDimensions.length * DIALECT_ROUTE_SCORING.axisFitMaximum
        : 0;
      const score = priorScore + travelScore + axisFitScore;
      return {
        id: route.id,
        score: Math.round(score * 100) / 100,
        priorScore: Math.round(priorScore * 100) / 100,
        travelScore,
        axisFitScore: Math.round(axisFitScore * 100) / 100,
        index,
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
}

export function getDialectPersonalityQuestion(questionId) {
  return questionById.get(questionId) ?? null;
}

export function getDialectQuizState(answers = [], questionIds) {
  const sessionQuestionIds = normalizeSessionQuestionIds(questionIds);
  const normalized = normalizeDialectAnswers(answers);
  const answeredQuestionIds = new Set(
    [...normalized.validAnswers.keys()].filter((questionId) => (
      sessionQuestionIds.includes(questionId)
    )),
  );
  const nextQuestionId = sessionQuestionIds
    .find((questionId) => !answeredQuestionIds.has(questionId));
  return {
    isComplete: !nextQuestionId,
    nextQuestionId: nextQuestionId ?? null,
    answeredCount: answeredQuestionIds.size,
    totalQuestions: sessionQuestionIds.length,
    invalidAnswerIds: normalized.invalidAnswerIds,
    inputWasInvalid: normalized.inputWasInvalid,
  };
}

export function computeDialectPersonality(answers = [], questionIds) {
  const sessionQuestionIds = normalizeSessionQuestionIds(questionIds);
  const sessionQuestionIdSet = new Set(sessionQuestionIds);
  const normalized = normalizeDialectAnswers(answers);
  const sessionValidAnswers = new Map(
    [...normalized.validAnswers.entries()].filter(([questionId]) => (
      sessionQuestionIdSet.has(questionId)
    )),
  );
  const missingQuestionIds = sessionQuestionIds
    .filter((questionId) => !sessionValidAnswers.has(questionId));
  const scoring = scoreAxes(sessionValidAnswers);
  const profileComplete = missingQuestionIds.length === 0
    && scoring.dimensionResults.every(({ isComplete }) => isComplete);
  const personality = profileComplete
    ? personaByCode.get(scoring.personalityCode) ?? null
    : null;
  const travelVariant = profileComplete
    ? deriveTravelVariant(scoring)
    : { goal: null, attraction: null, aversion: null };
  const isComplete = Boolean(personality && missingQuestionIds.length === 0);

  if (!personality) {
    return {
      personality: null,
      personalityId: null,
      ...scoring,
      personalityCode: null,
      routeId: null,
      routeRanking: [],
      routeMatchReason: null,
      routeVersionName: null,
      travelVariant,
      scoringVersion: DIALECT_ASSESSMENT_CONFIG.scoringVersion,
      answeredCount: sessionValidAnswers.size,
      totalQuestions: sessionQuestionIds.length,
      isComplete: false,
      missingQuestionIds,
      invalidAnswerIds: normalized.invalidAnswerIds,
      inputWasInvalid: normalized.inputWasInvalid,
    };
  }

  const routeRanking = isComplete ? rankRoutes(personality, travelVariant, scoring) : [];
  const routeId = routeRanking[0]?.id ?? null;
  const travelGoalLabel = DIALECT_TRAVEL_LABELS.goals[travelVariant.goal] ?? "待选择";
  const attractionLabel = DIALECT_TRAVEL_LABELS.attractions[travelVariant.attraction] ?? "待选择";
  const aversionLabel = DIALECT_TRAVEL_LABELS.aversions[travelVariant.aversion] ?? "待选择";
  const traitSummary = DIALECT_PERSONALITY_DIMENSIONS
    .map((dimension) => scoring.traitLabels[dimension.id])
    .filter(Boolean)
    .join(" · ");

  return {
    personality,
    personalityId: personality.id,
    personalityCode: personality.code,
    routeId,
    routeRanking,
    routeMatchReason: isComplete && scoring.dominantDimension
      ? `你的“${scoring.dominantDimension.selectedLabel}”倾向达到 ${scoring.dominantDimension.selectedPercentage}%；路线排序还会同时参考四维强度与本次偏好。`
      : null,
    routeVersionName: isComplete
      ? `${personality.dialectName} · ${travelGoalLabel} × ${attractionLabel}版`
      : null,
    variantKey: isComplete
      ? `${travelVariant.goal}-${travelVariant.attraction}-${travelVariant.aversion}`
      : null,
    travelVariant,
    scoringVersion: DIALECT_ASSESSMENT_CONFIG.scoringVersion,
    travelGoalLabel,
    travelGoalDetail: DIALECT_TRAVEL_LABELS.goalDetails[travelVariant.goal] ?? "待选择",
    attractionLabel,
    aversionLabel,
    ...scoring,
    traitSummary,
    clarityLabel: "四维倾向已计算",
    answeredCount: sessionValidAnswers.size,
    totalQuestions: sessionQuestionIds.length,
    isComplete,
    missingQuestionIds,
    invalidAnswerIds: normalized.invalidAnswerIds,
    inputWasInvalid: normalized.inputWasInvalid,
  };
}
