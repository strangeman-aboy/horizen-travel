import { useEffect, useRef, useState } from "react";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  FileTextIcon,
  GlobeIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import { travelApi } from "../api/travelApi.js";
import { extractShareUrl } from "../api/travelMappers.js";
import { readDroppedShareText } from "./integrationModel.js";
import "./integration.css";

export function XiaohongshuImportShelf({ onImported, className = "" }) {
  const [shareText, setShareText] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [successSummary, setSuccessSummary] = useState("");
  const [isDropActive, setIsDropActive] = useState(false);
  const requestInFlightRef = useRef(false);
  const requestControllerRef = useRef(null);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  const submitShare = async (candidate) => {
    if (requestInFlightRef.current) return;

    const sourceValue = String(candidate ?? "").trim();
    const shareUrl = extractShareUrl(sourceValue);
    if (!shareUrl) {
      setStatus("error");
      setError("请拖入或粘贴有效的小红书官方公开分享链接。");
      setSuccessSummary("");
      return;
    }

    const controller = new AbortController();
    requestControllerRef.current = controller;
    requestInFlightRef.current = true;
    setStatus("loading");
    setError("");
    setSuccessSummary("");

    try {
      const importRecord = await travelApi.importXiaohongshuShare(sourceValue, {
        signal: controller.signal,
      });
      const stopCount = importRecord.extraction?.stops?.length ?? 0;
      setStatus("success");
      setSuccessSummary(`已生成 ${stopCount} 个可编辑地点，正在加入规划画布。`);
      onImported?.(importRecord);
    } catch (requestError) {
      if (requestError?.code === "API_REQUEST_ABORTED") return;
      setStatus("error");
      setError(requestError?.message || "暂时无法读取这个分享链接，请稍后重试。");
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
      requestInFlightRef.current = false;
    }
  };

  const receiveDroppedText = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropActive(false);

    const dropped = readDroppedShareText(event.dataTransfer);
    if (!dropped.value) return;

    setShareText(dropped.shareUrl || dropped.value);
    setError("");
    setSuccessSummary("");
    void submitShare(dropped.value);
  };

  return (
    <section
      className={`rsi-xhs-shelf ${isDropActive ? "is-drop-active" : ""} ${className}`.trim()}
      data-integration="xiaohongshu-import"
      data-status={status}
      aria-labelledby="rsi-xhs-title"
      aria-busy={status === "loading"}
      onDragEnter={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDropActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsDropActive(false);
        }
      }}
      onDrop={receiveDroppedText}
    >
      <div className="rsi-xhs-shelf__intro">
        <span className="rsi-xhs-shelf__icon" aria-hidden="true"><FileTextIcon /></span>
        <span>
          <small>小红书笔记 → 规划画布</small>
          <strong id="rsi-xhs-title">拖入或粘贴公开分享链接</strong>
        </span>
      </div>

      <form
        className="rsi-xhs-shelf__form"
        onSubmit={(event) => {
          event.preventDefault();
          void submitShare(shareText);
        }}
      >
        <label>
          <GlobeIcon aria-hidden="true" />
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            value={shareText}
            disabled={status === "loading"}
            placeholder="粘贴 xiaohongshu.com 或 xhslink.com 分享链接"
            aria-label="小红书公开分享链接"
            aria-describedby="rsi-xhs-disclosure rsi-xhs-feedback"
            onChange={(event) => {
              setShareText(event.target.value);
              if (status !== "idle") setStatus("idle");
              setError("");
              setSuccessSummary("");
            }}
          />
        </label>
        <button
          type="submit"
          disabled={status === "loading" || !shareText.trim()}
        >
          {status === "loading"
            ? <ReloadIcon className="rsi-spin" />
            : <ArrowRightIcon />}
          <span>{status === "loading" ? "正在生成" : "加入画布"}</span>
        </button>
      </form>

      <div className="rsi-xhs-shelf__meta">
        <span id="rsi-xhs-disclosure">
          用户主动交接公开分享链接；当前路线地点为北京演示模板。
        </span>
        <span
          id="rsi-xhs-feedback"
          className={`rsi-xhs-shelf__feedback is-${status}`}
          role={status === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {status === "loading" ? (
            <>仅读取公开信息，不登录账号</>
          ) : status === "success" ? (
            <><CheckCircledIcon />{successSummary}</>
          ) : status === "error" ? (
            error
          ) : (
            <>拖放后自动提交 · 不读取私信或未公开内容</>
          )}
        </span>
      </div>
    </section>
  );
}

export default XiaohongshuImportShelf;
