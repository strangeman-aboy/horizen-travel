import { useEffect, useMemo, useState } from "react";
import {
  CheckCircledIcon,
  DrawingPinIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import {
  createBookingRedirect,
  listBookingOptions,
} from "../api/travelApi.js";
import {
  linkBookingOptionsToPlaces,
  normalizeMockBookingReceipt,
  selectBookingOptionsForStop,
} from "./integrationModel.js";
import "./integration.css";

const PRODUCT_LABELS = {
  DINING: "餐饮服务",
  ACTIVITY: "门票或活动",
};

export function MeituanBookingPanel({
  tripId,
  places = [],
  activeStopId = null,
  onSelectStop,
  className = "",
}) {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [state, setState] = useState(() => (
    tripId
      ? { status: "loading", data: null, error: "" }
      : { status: "idle", data: null, error: "" }
  ));
  const [pendingOptionId, setPendingOptionId] = useState(null);
  const [receipts, setReceipts] = useState({});
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPendingOptionId(null);
    setActionError("");
    setReceipts({});

    if (!tripId) {
      setState({ status: "idle", data: null, error: "" });
      return () => {
        cancelled = true;
      };
    }

    setState({ status: "loading", data: null, error: "" });
    listBookingOptions(tripId)
      .then((data) => {
        if (!cancelled) setState({ status: "success", data, error: "" });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: "error",
            data: null,
            error: error?.message || "暂时无法读取美团演示接入位。",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tripId, loadAttempt]);

  const linkedOptions = useMemo(
    () => linkBookingOptionsToPlaces(state.data?.options ?? [], places),
    [places, state.data?.options],
  );
  const visibleOptions = useMemo(
    () => selectBookingOptionsForStop(linkedOptions, activeStopId),
    [activeStopId, linkedOptions],
  );
  const providerConnected = Boolean(state.data?.provider?.connected);

  const recordIntent = async (option, place) => {
    if (!tripId || pendingOptionId || receipts[option.bookingOptionId]) return;

    setPendingOptionId(option.bookingOptionId);
    setActionError("");
    onSelectStop?.(place?.id ?? place?.clientStopId ?? option.clientStopId);

    try {
      const response = await createBookingRedirect(tripId, option.bookingOptionId);
      const receipt = normalizeMockBookingReceipt(response, option);
      setReceipts((current) => ({
        ...current,
        [option.bookingOptionId]: receipt,
      }));
    } catch (error) {
      setActionError(error?.message || "演示意向暂时无法记录，请重试。");
    } finally {
      setPendingOptionId(null);
    }
  };

  return (
    <section
      className={`rsi-booking-panel ${className}`.trim()}
      data-integration="meituan-booking"
      data-provider-connected={providerConnected ? "true" : "false"}
      aria-labelledby="rsi-booking-title"
    >
      <header className="rsi-booking-panel__header">
        <span className="rsi-booking-panel__brand" aria-hidden="true">美</span>
        <span>
          <strong id="rsi-booking-title">美团服务意向</strong>
          <small>按当前行程地址匹配 · 演示接入</small>
        </span>
        <em>{providerConnected ? "已连接" : "Mock · 未连接"}</em>
      </header>

      {!tripId ? (
        <div className="rsi-booking-panel__state">
          <strong>先确认并保存行程</strong>
          <span>保存后会按每一站的 clientStopId 展示对应地址和服务意向。</span>
        </div>
      ) : state.status === "loading" ? (
        <div className="rsi-booking-panel__state" role="status">
          <ReloadIcon className="rsi-spin" />
          <strong>正在读取演示接入位</strong>
          <span>不会查询真实价格、库存或订单。</span>
        </div>
      ) : state.status === "error" ? (
        <div className="rsi-booking-panel__state is-error" role="alert">
          <strong>暂时无法读取演示接入位</strong>
          <span>{state.error}</span>
          <button type="button" onClick={() => setLoadAttempt((current) => current + 1)}>
            <ReloadIcon />
            重新读取
          </button>
        </div>
      ) : visibleOptions.length === 0 ? (
        <div className="rsi-booking-panel__state">
          <strong>当前行程没有可展示的服务意向</strong>
          <span>请返回画布确认至少一个有效地点。</span>
        </div>
      ) : (
        <div className="rsi-booking-panel__options">
          {visibleOptions.map(({ option, place }) => {
            const receipt = receipts[option.bookingOptionId];
            const isPending = pendingOptionId === option.bookingOptionId;
            const placeIdentifier = place?.id ?? place?.clientStopId ?? option.clientStopId;
            return (
              <article
                key={option.bookingOptionId}
                className={receipt ? "is-recorded" : ""}
                data-client-stop-id={option.clientStopId}
              >
                <button
                  type="button"
                  className="rsi-booking-panel__place"
                  onClick={() => onSelectStop?.(placeIdentifier)}
                >
                  <span className="rsi-booking-panel__type">
                    {option.productType === "DINING" ? "餐" : "游"}
                  </span>
                  <span>
                    <small>{PRODUCT_LABELS[option.productType] ?? "旅行服务"}</small>
                    <strong>{place?.name ?? option.placeName ?? option.title}</strong>
                    <em><DrawingPinIcon />{option.address ?? place?.address ?? "地址待确认"}</em>
                  </span>
                </button>
                <div className="rsi-booking-panel__intent">
                  <span>
                    <small>演示价格</small>
                    <strong>{option.priceText ?? "待合作接口核验"}</strong>
                  </span>
                  <button
                    type="button"
                    disabled={isPending || Boolean(receipt)}
                    onClick={() => void recordIntent(option, place)}
                  >
                    {isPending
                      ? <><ReloadIcon className="rsi-spin" />记录中</>
                      : receipt
                        ? <><CheckCircledIcon />已记录</>
                        : "记录服务意向"}
                  </button>
                </div>
                {receipt ? (
                  <p className="rsi-booking-panel__receipt" role="status">
                    <CheckCircledIcon />
                    <span>
                      <strong>Mock receipt 已记录</strong>
                      <small>{receipt.message}</small>
                      {receipt.redirectId ? <code>{receipt.redirectId}</code> : null}
                    </span>
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {actionError ? (
        <p className="rsi-booking-panel__action-error" role="alert">{actionError}</p>
      ) : null}

      <footer className="rsi-booking-panel__disclosure">
        <strong>演示边界</strong>
        <span>未查询美团真实价格、库存或订单，也不代表已与美团合作；记录意向不会跳转支付。</span>
      </footer>
    </section>
  );
}

export default MeituanBookingPanel;
