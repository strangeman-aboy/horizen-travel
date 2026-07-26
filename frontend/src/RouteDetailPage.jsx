import { useState } from "react";
import {
  ArrowLeftIcon,
  BookmarkFilledIcon,
  BookmarkIcon,
  ChatBubbleIcon,
  CheckCircledIcon,
  ClockIcon,
  DotsHorizontalIcon,
  EnterFullScreenIcon,
  HeartFilledIcon,
  HeartIcon,
  ImageIcon,
  MagicWandIcon,
  MinusIcon,
  PaperPlaneIcon,
  PlusIcon,
  Share1Icon,
} from "@radix-ui/react-icons";
import "./route-detail.css";

const routeStops = [
  {
    id: 1,
    name: "南锣鼓巷",
    time: "09:00",
    image: "/assets/beijing-hero-hutong.png",
    description: "晨光里的胡同慢行",
    duration: "1.5 小时",
    tag: "胡同",
    position: { left: "19%", top: "31%" },
    placement: "above",
  },
  {
    id: 2,
    name: "五道营胡同",
    time: "10:30",
    image: "/assets/beijing-wudaoying.png",
    description: "独立小店与在地生活",
    duration: "1 小时",
    tag: "漫步",
    position: { left: "32%", top: "63%" },
    placement: "above",
  },
  {
    id: 3,
    name: "国子监街",
    time: "12:15",
    image: "/assets/beijing-guozijian.png",
    description: "灰砖红门的古建街区",
    duration: "1 小时",
    tag: "文化",
    position: { left: "40%", top: "83%" },
    placement: "above",
  },
  {
    id: 4,
    name: "798 艺术区",
    time: "14:30",
    image: "/assets/beijing-guardian-art.png",
    description: "当代艺术与工业遗存",
    duration: "2.5 小时",
    tag: "艺术",
    position: { left: "60%", top: "40%" },
    placement: "above",
  },
  {
    id: 5,
    name: "景山公园落日",
    time: "17:30",
    image: "/assets/beijing-jingshan.png",
    description: "中轴线上的金色收尾",
    duration: "1 小时",
    tag: "观景",
    position: { left: "79%", top: "15%" },
    placement: "above",
  },
];

const routePlan = {
  id: "beijing-hutong-art-sunset",
  title: "北京的一天：胡同、艺文与中轴落日",
  creator: "林予安 · LensJourney",
  city: "北京",
  stopIds: routeStops.map((stop) => stop.id),
};

const personalTips = [
  "尽量在 9 点前进入胡同，清晨的人流更少，光线也更柔和。",
  "五道营的小店多在 10 点后营业，先散步，再找一杯胡同咖啡。",
  "798 园区很大，至少预留 2–3 小时，并提前确认展馆开放时间。",
  "景山万春亭日落很值得，但需要在闭园前留足登高时间。",
];

export function RouteDetailPage({ onBack, onUsePlan, onToast }) {
  const [isSaved, setIsSaved] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [activeStopId, setActiveStopId] = useState(1);

  const notify = (message) => {
    onToast?.(message);
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    notify("返回首页");
  };

  const handleUsePlan = () => {
    onUsePlan?.(routePlan);
    notify("已把这条博主路线载入规划画布");
  };

  const toggleSaved = () => {
    const nextSaved = !isSaved;
    setIsSaved(nextSaved);
    notify(nextSaved ? "已收藏这条路线" : "已从收藏中移除");
  };

  const toggleLiked = () => {
    const nextLiked = !isLiked;
    setIsLiked(nextLiked);
    notify(nextLiked ? "已喜欢这条路线" : "已取消喜欢");
  };

  const selectStop = (stop) => {
    setActiveStopId(stop.id);
    notify(`正在查看第 ${stop.id} 站：${stop.name}`);
  };

  return (
    <main className="route-detail-page" aria-labelledby="route-detail-title">
      <header className="route-detail-topbar">
        <button type="button" className="route-detail-back" onClick={handleBack}>
          <ArrowLeftIcon />
          返回首页
        </button>

        <div className="route-detail-top-actions">
          <span className="route-detail-ai-note">
            <MagicWandIcon />
            AI 已整理路线顺序
          </span>
          <span className="route-detail-optimized">
            动线已优化
            <CheckCircledIcon />
          </span>
          <button type="button" className="route-detail-use-button" onClick={handleUsePlan}>
            使用此规划
          </button>
          <button
            type="button"
            className="route-detail-icon-button"
            aria-label="更多路线操作"
            onClick={() => notify("更多路线操作即将开放")}
          >
            <DotsHorizontalIcon />
          </button>
        </div>
      </header>

      <div className="route-detail-layout">
        <article className="route-detail-story">
          <figure className="route-detail-hero">
            <img src="/assets/beijing-hero-hutong.png" alt="阳光照进北京老城胡同" />
            <figcaption>
              <ImageIcon />
              1 / 18
            </figcaption>
          </figure>

          <section className="route-detail-story-copy">
            <h1 id="route-detail-title">北京的一天：胡同、艺文与中轴落日</h1>

            <div className="route-detail-author-row">
              <div className="route-detail-author">
                <img src="/assets/creator-lin.png" alt="路线作者林予安" />
                <span>
                  <strong>
                    林予安 · LensJourney
                    <CheckCircledIcon />
                  </strong>
                  <small>北京 · 真实走过 18 条路线</small>
                </span>
              </div>

              <button
                type="button"
                className={`route-detail-save ${isSaved ? "saved" : ""}`}
                aria-pressed={isSaved}
                onClick={toggleSaved}
              >
                {isSaved ? <BookmarkFilledIcon /> : <BookmarkIcon />}
                {isSaved ? "已收藏" : "收藏"}
              </button>
            </div>

            <p className="route-detail-intro">
              用一天读懂北京老城的新与旧：从安静的胡同晨光出发，穿过独立小店和灰砖红门，
              下午留给当代艺术，最后在景山看中轴线被落日点亮。
            </p>

            <aside className="route-detail-tips" aria-labelledby="route-detail-tips-title">
              <h2 id="route-detail-tips-title">我的个人建议</h2>
              <ul>
                {personalTips.map((tip) => (
                  <li key={tip}>
                    <CheckCircledIcon />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </section>

          <footer className="route-detail-social">
            <div className="route-detail-social-counts">
              <strong>{isLiked ? "2.4K" : "2.3K"} 喜欢</strong>
              <span>127 条评论</span>
            </div>
            <div className="route-detail-social-actions">
              <button
                type="button"
                className={isLiked ? "active" : ""}
                aria-pressed={isLiked}
                onClick={toggleLiked}
              >
                {isLiked ? <HeartFilledIcon /> : <HeartIcon />}
                喜欢
              </button>
              <button type="button" onClick={() => notify("评论区已展开")}>
                <ChatBubbleIcon />
                评论
              </button>
              <button type="button" onClick={() => notify("分享链接已复制")}>
                <Share1Icon />
                分享
              </button>
              <button type="button" aria-label="更多互动" onClick={() => notify("更多互动方式即将开放")}>
                <DotsHorizontalIcon />
              </button>
            </div>
          </footer>
        </article>

        <section className="route-detail-route-column" aria-label="路线地图与站点">
          <div className="route-detail-map-card">
            <img className="route-detail-map-image" src="/assets/beijing-route-map.png" alt="北京路线地图" />

            <div className="route-detail-map-controls route-detail-map-controls-top">
              <button type="button" aria-label="全屏查看地图" onClick={() => notify("地图全屏查看")}>
                <EnterFullScreenIcon />
              </button>
            </div>

            <div className="route-detail-map-controls route-detail-map-controls-zoom">
              <button type="button" aria-label="放大地图" onClick={() => notify("地图已放大")}>
                <PlusIcon />
              </button>
              <button type="button" aria-label="缩小地图" onClick={() => notify("地图已缩小")}>
                <MinusIcon />
              </button>
            </div>

            <button
              type="button"
              className="route-detail-locate"
              aria-label="定位到我的位置"
              onClick={() => notify("已定位到当前路线附近")}
            >
              <PaperPlaneIcon />
            </button>

            {routeStops.map((stop) => (
              <button
                type="button"
                key={stop.id}
                className={`route-detail-map-node ${stop.placement} ${activeStopId === stop.id ? "active" : ""}`}
                style={{ "--node-left": stop.position.left, "--node-top": stop.position.top }}
                aria-label={`第 ${stop.id} 站，${stop.name}，${stop.time}`}
                onClick={() => selectStop(stop)}
              >
                <span className="route-detail-map-node-thumb">
                  <img src={stop.image} alt="" />
                  <i>{stop.id}</i>
                </span>
                <span className="route-detail-map-node-copy">
                  <strong>{stop.name}</strong>
                  <small>{stop.time}</small>
                </span>
              </button>
            ))}

            <button type="button" className="route-detail-full-route" onClick={() => notify("已显示完整路线")}>
              <EnterFullScreenIcon />
              查看完整路线
            </button>
          </div>

          <section className="route-detail-stops" aria-labelledby="route-detail-stops-title">
            <header>
              <div>
                <h2 id="route-detail-stops-title">
                  <MagicWandIcon />
                  这条路线的更多站点
                </h2>
                <p>按照博主真实行程排序，点击可在地图中定位</p>
              </div>
              <button type="button" onClick={() => notify("已展示全部 5 个站点")}>
                查看全部（5）
              </button>
            </header>

            <div className="route-detail-stop-list">
              {routeStops.map((stop) => (
                <article
                  key={stop.id}
                  className={`route-detail-stop-card ${activeStopId === stop.id ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="route-detail-stop-main"
                    aria-label={`在地图查看${stop.name}`}
                    onClick={() => selectStop(stop)}
                  >
                    <span className="route-detail-stop-image">
                      <img src={stop.image} alt={`${stop.name}实景`} />
                      <i>{stop.id}</i>
                    </span>
                    <span className="route-detail-stop-copy">
                      <strong>{stop.name}</strong>
                      <small>{stop.description}</small>
                      <em>
                        <span><ClockIcon />{stop.duration}</span>
                        <span>{stop.tag}</span>
                      </em>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="route-detail-stop-save"
                    aria-label={`收藏${stop.name}`}
                    onClick={() => notify(`已收藏「${stop.name}」`)}
                  >
                    <BookmarkIcon />
                  </button>
                </article>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

export default RouteDetailPage;
