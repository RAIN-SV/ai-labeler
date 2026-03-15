"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Check, Sparkles, Video, ExternalLink, Star, RefreshCw, AlertCircle, ChevronDown, Sliders, Zap } from "lucide-react";
import { API_BASE } from "../../lib/supabase";

export interface ModelConfig {
  baseUrl: string;
  visionModel: string;
  textModel: string;
  videoMode: "frames" | "native";
}

type ModalType = "image" | "audio" | "video" | "text";

export interface PresetItem {
  label:          string;
  icon:           string;
  tag?:           string;
  desc?:          string;
  rank?:          string;
  recommend?:     ModalType[];
  apiKeyUrl?:     string;
  intelligence?:  number | null;
  speedTps?:      number | null;
  priceInput?:    number | null;
  priceOutput?:   number | null;
  contextWindow?: number | null;
  knowledgeCutoff?: string | null;
  supportsImage?: boolean;
  supportsVideo?: boolean;
  supportsAudio?: boolean;
  config:         ModelConfig;
}

export interface ModelSnapshot {
  updatedAt?:   string | null;
  updatedAtCn?: string | null;
  source?:      string;
  presets:      PresetItem[];
}

export const FALLBACK_PRESETS: PresetItem[] = [
  {
    label: "Gemini 2.5 Pro", icon: "🏆", tag: "综合最强",
    desc: "AA Intelligence 35，124 t/s，全模态支持（图/音/视频）",
    rank: "AA Intelligence 35", recommend: ["image", "video", "audio"],
    apiKeyUrl: "https://aistudio.google.com/apikey",
    intelligence: 35, speedTps: 124, priceInput: 1.25,
    supportsImage: true, supportsVideo: true, supportsAudio: true,
    config: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      visionModel: "gemini-2.5-pro-preview-03-25", textModel: "gemini-2.5-pro-preview-03-25", videoMode: "native" },
  },
  {
    label: "Gemini 2.5 Flash", icon: "⚡", tag: "极速性价比",
    desc: "AA Intelligence 27，226 t/s，$0.30/M，支持图/音/视频",
    rank: "AA Intelligence 27", recommend: ["image", "video", "audio", "text"],
    apiKeyUrl: "https://aistudio.google.com/apikey",
    intelligence: 27, speedTps: 226, priceInput: 0.3,
    supportsImage: true, supportsVideo: true, supportsAudio: true,
    config: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      visionModel: "gemini-2.5-flash-preview-04-17", textModel: "gemini-2.5-flash-preview-04-17", videoMode: "native" },
  },
  {
    label: "Claude 3.7 Sonnet", icon: "🧠", tag: "图文推荐",
    desc: "AA Intelligence 35，深度图文理解，200k 上下文",
    rank: "AA Intelligence 35", recommend: ["image", "text"],
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    intelligence: 35, priceInput: 3.0, supportsImage: true,
    config: { baseUrl: "https://api.anthropic.com/v1",
      visionModel: "claude-3-7-sonnet-20250219", textModel: "claude-3-7-sonnet-20250219", videoMode: "frames" },
  },
  {
    label: "GPT-4.1", icon: "🤖", tag: "图像理解",
    desc: "AA Intelligence 26，87 t/s，OpenAI 最新视觉模型",
    rank: "AA Intelligence 26", recommend: ["image", "text"],
    apiKeyUrl: "https://platform.openai.com/api-keys",
    intelligence: 26, speedTps: 87, supportsImage: true,
    config: { baseUrl: "https://api.openai.com/v1",
      visionModel: "gpt-4.1", textModel: "gpt-4.1", videoMode: "frames" },
  },
  {
    label: "Qwen2.5-VL 原生视频", icon: "🎬", tag: "视频推荐",
    desc: "原生视频 URL 输入，时序理解+音轨转录，国内可用",
    rank: "开源视频最强", recommend: ["video", "image"],
    apiKeyUrl: "https://bailian.console.aliyun.com/?apiKey=1#/api-key",
    supportsImage: true, supportsVideo: true,
    config: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      visionModel: "qwen2.5-vl-72b-instruct", textModel: "qwen-max", videoMode: "native" },
  },
  {
    label: "Qwen-Omni Turbo", icon: "🎙️", tag: "音频推荐",
    desc: "原生音频输入，无需转录，直接理解音频内容，国内可用",
    rank: "音频直接输入", recommend: ["audio", "video"],
    apiKeyUrl: "https://bailian.console.aliyun.com/?apiKey=1#/api-key",
    supportsImage: true, supportsVideo: true, supportsAudio: true,
    config: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      visionModel: "qwen-omni-turbo", textModel: "qwen-omni-turbo", videoMode: "native" },
  },
  {
    label: "硅基 Qwen2.5-VL", icon: "💎", tag: "国内中转",
    desc: "硅基流动代理，国内网络可稳定访问 Qwen2.5-VL",
    rank: "国内可用视频", recommend: ["video", "image"],
    apiKeyUrl: "https://cloud.siliconflow.cn/account/ak",
    supportsImage: true, supportsVideo: true,
    config: { baseUrl: "https://api.siliconflow.cn/v1",
      visionModel: "Qwen/Qwen2.5-VL-72B-Instruct", textModel: "Qwen/Qwen2.5-72B-Instruct", videoMode: "frames" },
  },
  {
    label: "GPT-4o mini", icon: "💰", tag: "经济图像",
    desc: "AA Intelligence 13，$0.15/M 极低价，支持图像输入",
    rank: "AA Intelligence 13", recommend: ["image"],
    apiKeyUrl: "https://platform.openai.com/api-keys",
    intelligence: 13, speedTps: 40, priceInput: 0.15, supportsImage: true,
    config: { baseUrl: "https://api.openai.com/v1",
      visionModel: "gpt-4o-mini", textModel: "gpt-4o-mini", videoMode: "frames" },
  },
  {
    label: "DeepSeek-V3", icon: "🌊", tag: "纯文本",
    desc: "AA Intelligence 22，极低价格文本模型，不支持图像/视频",
    rank: "AA Intelligence 22", recommend: ["text"],
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    intelligence: 22,
    config: { baseUrl: "https://api.deepseek.com/v1",
      visionModel: "deepseek-chat", textModel: "deepseek-chat", videoMode: "frames" },
  },
];

export const DEFAULT_CONFIG: ModelConfig = FALLBACK_PRESETS[0].config;
export const PRESETS = FALLBACK_PRESETS;

interface Props {
  config: ModelConfig;
  onChange: (c: ModelConfig) => void;
  currentModal?: ModalType;
  initialTab?: "presets" | "custom"; // 直接打开到哪个区域
}

function formatTimeAgo(isoStr: string | null | undefined): string {
  if (!isoStr) return "";
  try {
    const diff = Date.now() - new Date(isoStr).getTime();
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days >= 7) return `${Math.floor(days / 7)} 周前`;
    if (days >= 1) return `${days} 天前`;
    if (hours >= 1) return `${hours} 小时前`;
    return "刚刚";
  } catch { return ""; }
}

// 每个模态最多显示多少个推荐（折叠前）
const TOP_N = 2;

export default function ModelConfigPanel({ config, onChange, currentModal, initialTab }: Props) {
  const [open, setOpen]           = useState(false);
  const [draft, setDraft]         = useState<ModelConfig>(config);
  const [presets, setPresets]     = useState<PresetItem[]>(FALLBACK_PRESETS);
  const [snapshot, setSnapshot]   = useState<ModelSnapshot | null>(null);
  const [loading, setLoading]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [allExpanded, setAllExpanded] = useState(false);
  const [panelTab, setPanelTab]   = useState<"presets" | "custom">("presets");

  const openPanel = (forceCustom?: boolean) => {
    setDraft(config);
    setPanelTab(forceCustom || initialTab === "custom" ? "custom" : "presets");
    setOpen(true);
  };

  const loadPresets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`${API_BASE}/model-presets`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ModelSnapshot = await res.json();
      if (data.presets?.length > 0) { setPresets(data.presets); setSnapshot(data); }
    } catch {
      if (!silent) setFetchError("无法加载最新榜单，使用内置数据");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) loadPresets(true); }, [open, loadPresets]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`${API_BASE}/model-presets/refresh`, { method: "POST" });
      await new Promise(r => setTimeout(r, 3000));
      await loadPresets(false);
    } catch { /**/ } finally { setRefreshing(false); }
  };

  const activePreset = presets.find(
    p => p.config.baseUrl === config.baseUrl &&
         p.config.visionModel === config.visionModel &&
         p.config.textModel === config.textModel
  );

  const handleApply = () => { onChange(draft); setOpen(false); };
  const isMatch = (p: PresetItem) =>
    draft.baseUrl === p.config.baseUrl && draft.visionModel === p.config.visionModel;

  // 当前模态推荐的模型（前 TOP_N 显示，其余折叠）
  const recommendedPresets = currentModal
    ? presets.filter(p => p.recommend?.includes(currentModal))
    : presets;
  const topPresets    = recommendedPresets.slice(0, TOP_N);
  const morePresets   = recommendedPresets.slice(TOP_N);
  const otherPresets  = currentModal
    ? presets.filter(p => !p.recommend?.includes(currentModal))
    : [];

  const timeAgo = formatTimeAgo(snapshot?.updatedAt);
  const updatedLabel = snapshot?.updatedAtCn
    ? `${snapshot.updatedAtCn}${timeAgo ? `（${timeAgo}）` : ""}`
    : null;

  return (
    <>
      {/* 触发按钮：「预设模型」+「自定义 API」并列 */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <button onClick={() => openPanel(false)} className="btn btn-glass"
          style={{ gap: 5, borderRadius: 10, fontSize: 11, height: 32, padding: "0 12px" }}>
          <Sparkles size={11} style={{ color: "#F59E0B" }} />
          <span>预设模型</span>
          {activePreset && (
            <span style={{
              fontSize: 10, color: "rgba(255,255,255,0.50)", marginLeft: 2,
              maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {activePreset.icon} {activePreset.label}
            </span>
          )}
        </button>
        <button onClick={() => openPanel(true)} className="btn btn-glass"
          style={{ gap: 4, borderRadius: 10, fontSize: 11, height: 32, padding: "0 10px" }}>
          <Sliders size={11} style={{ color: "rgba(255,255,255,0.55)" }} />
          <span>自定义 API</span>
        </button>
      </div>

      {open && (
        <div className="modal-overlay"
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex",
            alignItems: "stretch", justifyContent: "flex-end",
            background: "rgba(0,0,0,0.25)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>

          <div className="drawer-body"
            style={{
              width: "100%", maxWidth: 420, height: "100%",
              display: "flex", flexDirection: "column",
              background: "var(--bg-white)",
              borderLeft: "0.5px solid var(--separator-heavy)",
              boxShadow: "var(--shadow-xl)",
              animation: "slideInRight 250ms var(--ease-spring)",
            }}>

            {/* ── 头部 ── */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "16px 20px 12px",
              background: "linear-gradient(135deg, var(--accent) 0%, #6366F1 100%)",
            }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                  <Sparkles size={14} style={{ color: "rgba(255,255,255,0.9)" }} />
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>模型配置</h2>
                </div>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.65)" }}>选择供应商 · 视频处理模式</p>
              </div>
              <button onClick={() => setOpen(false)}
                style={{
                  padding: 6, borderRadius: 8, width: 30, height: 30, border: "none",
                  background: "rgba(255,255,255,0.18)", cursor: "pointer", display: "flex",
                  alignItems: "center", justifyContent: "center", color: "#fff",
                }}>
                <X size={14} />
              </button>
            </div>

            {/* ── 数据来源条（仅预设模型 Tab） ── */}
            {panelTab === "presets" && (
            <div style={{
              padding: "7px 16px",
              borderBottom: "0.5px solid var(--separator)",
              background: "var(--bg-secondary)",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
              flexShrink: 0,
            }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                {loading ? (
                  <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>加载中…</span>
                ) : fetchError ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <AlertCircle size={9} style={{ color: "var(--orange)", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: "var(--orange)" }}>{fetchError}</span>
                  </div>
                ) : (
                  <>
                    <span style={{ fontSize: 10, color: "var(--text-quaternary)" }}>榜单来源</span>
                    <a href="https://artificialanalysis.ai/leaderboards/models" target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ fontSize: 10, color: "var(--accent)", textDecoration: "none",
                        display: "inline-flex", alignItems: "center", gap: 2 }}>
                      Artificial Analysis <ExternalLink size={7} />
                    </a>
                    {updatedLabel && (
                      <span style={{ fontSize: 10, color: "var(--text-quaternary)" }}>· {updatedLabel}</span>
                    )}
                  </>
                )}
              </div>
              <button onClick={handleRefresh} disabled={refreshing} title="重新抓取 AA 榜单"
                style={{
                  padding: "3px 8px", borderRadius: 6, fontSize: 10,
                  border: "0.5px solid var(--separator)", background: "var(--bg-white)",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                  opacity: refreshing ? 0.6 : 1, flexShrink: 0, color: "var(--text-secondary)",
                }}>
                <RefreshCw size={9} style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} />
                {refreshing ? "更新中" : "刷新"}
              </button>
            </div>
            )}

            {/* ── Tab 切换 ── */}
            <div style={{
              display: "flex", padding: "8px 16px 0",
              borderBottom: "0.5px solid var(--separator)",
              background: "var(--bg-secondary)",
              flexShrink: 0, gap: 0,
            }}>
              {[
                { id: "presets" as const, icon: <Sparkles size={11} />, label: "推荐模型" },
                { id: "custom"  as const, icon: <Sliders  size={11} />, label: "自定义 API" },
              ].map(t => (
                <button key={t.id} onClick={() => setPanelTab(t.id)}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 5, padding: "8px 0", fontSize: 12, fontWeight: panelTab === t.id ? 600 : 400,
                    border: "none", cursor: "pointer",
                    background: "transparent",
                    color: panelTab === t.id ? "var(--accent)" : "var(--text-tertiary)",
                    borderBottom: panelTab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                    transition: "all 150ms var(--ease-smooth)",
                    marginBottom: -0.5,
                  }}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>

            {/* ── 内容区 ── */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px",
              display: "flex", flexDirection: "column", gap: 16 }}>

              {/* ══ 推荐模型 Tab ══ */}
              {panelTab === "presets" && (<>

              {/* ─ 推荐模型（当前模态专属，展示前 TOP_N 个，超出折叠） ─ */}
              <div>
                {currentModal && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <Star size={11} fill="var(--accent)" style={{ color: "var(--accent)" }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)",
                      letterSpacing: "0.01em" }}>
                      {{ image: "图像", audio: "音频", video: "视频", text: "文本" }[currentModal]} 推荐
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-quaternary)" }}>
                      · 共 {recommendedPresets.length} 个适配
                    </span>
                  </div>
                )}

                {/* 前 TOP_N 个推荐 */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {topPresets.map(p => (
                    <PresetCard key={p.label} preset={p} isMatch={isMatch(p)}
                      isRecommended={true} onClick={() => setDraft(p.config)} />
                  ))}
                </div>

                {/* "展开更多推荐"按钮 */}
                {morePresets.length > 0 && (
                  <>
                    <button
                      onClick={() => setAllExpanded(v => !v)}
                      style={{
                        display: "flex", alignItems: "center", gap: 5, width: "100%",
                        padding: "7px 10px", marginTop: 6, borderRadius: 8,
                        border: "0.5px dashed var(--separator-heavy)",
                        background: "transparent", cursor: "pointer",
                        fontSize: 11, color: "var(--text-tertiary)",
                        transition: "all 150ms",
                      }}>
                      <ChevronDown size={11} style={{
                        transform: allExpanded ? "rotate(180deg)" : "none",
                        transition: "transform 200ms var(--ease-smooth)",
                      }} />
                      {allExpanded ? "收起" : `展开更多 ${morePresets.length} 个推荐模型`}
                    </button>
                    {allExpanded && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                        {morePresets.map(p => (
                          <PresetCard key={p.label} preset={p} isMatch={isMatch(p)}
                            isRecommended={true} onClick={() => setDraft(p.config)} />
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* 分隔线 + 其他模型 */}
                {currentModal && otherPresets.length > 0 && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 10px" }}>
                      <div style={{ flex: 1, height: 0.5, background: "var(--separator)" }} />
                      <span style={{ fontSize: 10, color: "var(--text-quaternary)" }}>其他模型</span>
                      <div style={{ flex: 1, height: 0.5, background: "var(--separator)" }} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {otherPresets.map(p => (
                        <PresetCard key={p.label} preset={p} isMatch={isMatch(p)}
                          isRecommended={false} onClick={() => setDraft(p.config)} compact />
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* ─ 视频处理模式开关 ─ */}
              <div style={{
                borderRadius: 12, padding: "12px 14px",
                background: draft.videoMode === "native"
                  ? "linear-gradient(135deg, rgba(48,209,88,0.10) 0%, rgba(52,199,89,0.04) 100%)"
                  : "var(--bg-secondary)",
                border: `0.5px solid ${draft.videoMode === "native" ? "rgba(52,199,89,0.35)" : "var(--separator)"}`,
                transition: "all 250ms var(--ease-smooth)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <Video size={12} style={{ color: draft.videoMode === "native" ? "var(--green)" : "var(--text-tertiary)" }} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>视频处理模式</span>
                  </div>
                  <button
                    onClick={() => setDraft(d => ({ ...d, videoMode: d.videoMode === "native" ? "frames" : "native" }))}
                    style={{
                      width: 40, height: 22, borderRadius: 11, cursor: "pointer",
                      background: draft.videoMode === "native"
                        ? "linear-gradient(90deg, var(--green), #22C55E)" : "var(--bg-tertiary)",
                      border: "none", position: "relative",
                      transition: "background 250ms var(--ease-smooth)",
                      boxShadow: draft.videoMode === "native" ? "0 2px 6px rgba(34,197,94,0.35)" : "none",
                    }}>
                    <span style={{
                      position: "absolute", top: 1,
                      left: draft.videoMode === "native" ? 19 : 1,
                      width: 20, height: 20, borderRadius: "50%",
                      background: "#fff",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
                      transition: "left 250ms var(--ease-spring)",
                    }} />
                  </button>
                </div>
                <p style={{ fontSize: 10.5, marginTop: 6, color: draft.videoMode === "native" ? "var(--green)" : "var(--text-tertiary)", lineHeight: 1.6 }}>
                  {draft.videoMode === "native"
                    ? "✅ 原生视频 URL · 时序分析 · 自动提取音轨"
                    : "🎞️ 提帧兼容 · 截取关键帧 · 适配所有视觉模型"}
                </p>
              </div>

              {/* ─ 当前配置预览 ─ */}
              <div style={{ borderRadius: 11, padding: "11px 13px",
                background: "var(--bg-secondary)", border: "0.5px solid var(--separator)" }}>
                <p style={{ fontSize: 10, fontWeight: 600, color: "var(--text-quaternary)",
                  marginBottom: 7, letterSpacing: "0.04em", textTransform: "uppercase" }}>当前选择</p>
                {[
                  { k: "Vision",   v: draft.visionModel, c: "var(--accent)" },
                  { k: "Text",     v: draft.textModel,   c: "var(--orange)" },
                  { k: "Video",    v: draft.videoMode === "native" ? "原生 URL ✅" : "提帧模式",
                    c: draft.videoMode === "native" ? "var(--green)" : "var(--text-tertiary)" },
                ].map(({ k, v, c }) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, marginBottom: 3 }}>
                    <span style={{ width: 42, flexShrink: 0, color: "var(--text-quaternary)", fontSize: 10 }}>{k}</span>
                    <span style={{ fontFamily: "ui-monospace, monospace", color: c,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{v || "—"}</span>
                  </div>
                ))}
              </div>

            </>)}

              {/* ══ 自定义 API Tab ══ */}
              {panelTab === "custom" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                  {/* 说明 */}
                  <div style={{ padding: "10px 13px", borderRadius: 10,
                    background: "rgba(26,86,255,0.06)", border: "0.5px solid rgba(26,86,255,0.15)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <Zap size={11} style={{ color: "var(--accent)" }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>OpenAI 兼容接口</span>
                    </div>
                    <p style={{ fontSize: 10.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      填写任意兼容 OpenAI 格式的 API 地址和模型名称，配合顶栏 API Key 使用。
                    </p>
                  </div>

                  {/* 快速填入按钮 */}
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 600, color: "var(--text-quaternary)",
                      marginBottom: 7, letterSpacing: "0.04em", textTransform: "uppercase" }}>快速填入</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {[
                        { label: "OpenAI", baseUrl: "https://api.openai.com/v1", vision: "gpt-4o", text: "gpt-4o" },
                        { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", vision: "claude-3-5-sonnet-20241022", text: "claude-3-5-sonnet-20241022" },
                        { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", vision: "gemini-2.0-flash", text: "gemini-2.0-flash" },
                        { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", vision: "deepseek-chat", text: "deepseek-chat" },
                      ].map(q => (
                        <button key={q.label} onClick={() => setDraft(d => ({ ...d, baseUrl: q.baseUrl, visionModel: q.vision, textModel: q.text }))}
                          style={{
                            padding: "4px 10px", borderRadius: 8, fontSize: 11, cursor: "pointer",
                            border: "0.5px solid var(--separator)", background: "var(--bg-secondary)",
                            color: "var(--text-secondary)", transition: "all 120ms",
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--accent-subtle)"; (e.currentTarget as HTMLElement).style.color = "var(--accent)"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg-secondary)"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}>
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 表单字段 */}
                  {[
                    { label: "API Base URL", key: "baseUrl", placeholder: "https://api.openai.com/v1" },
                    { label: "视觉 / 视频模型", key: "visionModel", placeholder: "gpt-4o / qwen2.5-vl-72b-instruct" },
                    { label: "文本模型", key: "textModel", placeholder: "gpt-4o / qwen-plus" },
                  ].map(({ label, key, placeholder }) => (
                    <div key={key}>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 500,
                        color: "var(--text-secondary)", marginBottom: 5 }}>{label}</label>
                      <input value={draft[key as keyof ModelConfig]}
                        onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className="input"
                        style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, borderRadius: 9, height: 34 }} />
                    </div>
                  ))}

                  {/* 视频处理模式开关（自定义 Tab 也有） */}
                  <div style={{
                    borderRadius: 12, padding: "12px 14px",
                    background: draft.videoMode === "native"
                      ? "linear-gradient(135deg, rgba(48,209,88,0.10) 0%, rgba(52,199,89,0.04) 100%)"
                      : "var(--bg-secondary)",
                    border: `0.5px solid ${draft.videoMode === "native" ? "rgba(52,199,89,0.35)" : "var(--separator)"}`,
                    transition: "all 250ms var(--ease-smooth)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <Video size={12} style={{ color: draft.videoMode === "native" ? "var(--green)" : "var(--text-tertiary)" }} />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>视频处理模式</span>
                      </div>
                      <button
                        onClick={() => setDraft(d => ({ ...d, videoMode: d.videoMode === "native" ? "frames" : "native" }))}
                        style={{
                          width: 40, height: 22, borderRadius: 11, cursor: "pointer",
                          background: draft.videoMode === "native"
                            ? "linear-gradient(90deg, var(--green), #22C55E)" : "var(--bg-tertiary)",
                          border: "none", position: "relative",
                          transition: "background 250ms var(--ease-smooth)",
                          boxShadow: draft.videoMode === "native" ? "0 2px 6px rgba(34,197,94,0.35)" : "none",
                        }}>
                        <span style={{
                          position: "absolute", top: 1,
                          left: draft.videoMode === "native" ? 19 : 1,
                          width: 20, height: 20, borderRadius: "50%",
                          background: "#fff",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
                          transition: "left 250ms var(--ease-spring)",
                        }} />
                      </button>
                    </div>
                    <p style={{ fontSize: 10.5, marginTop: 6, color: draft.videoMode === "native" ? "var(--green)" : "var(--text-tertiary)", lineHeight: 1.6 }}>
                      {draft.videoMode === "native"
                        ? "✅ 原生视频 URL · 时序分析 · 自动提取音轨"
                        : "🎞️ 提帧兼容 · 截取关键帧 · 适配所有视觉模型"}
                    </p>
                  </div>

                </div>
              )}

            </div>

            {/* ── 底部操作栏 ── */}
            <div style={{ padding: "12px 16px", display: "flex", gap: 8,
              borderTop: "0.5px solid var(--separator)", flexShrink: 0 }}>
              <button onClick={handleApply} className="btn btn-primary"
                style={{ flex: 1, height: 38, borderRadius: 10, fontSize: 13, justifyContent: "center",
                  background: "linear-gradient(135deg, var(--accent) 0%, #6366F1 100%)",
                  boxShadow: "0 4px 14px rgba(26,86,255,0.30)" }}>
                <Check size={13} /> 应用配置
              </button>
              <button onClick={() => setOpen(false)}
                style={{ height: 38, padding: "0 16px", borderRadius: 10, border: "0.5px solid var(--separator)",
                  background: "var(--bg-secondary)", cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes slideInRight { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>
    </>
  );
}

/* ─── 预设卡片组件 ─────────────────────────────────────────── */
function PresetCard({ preset: p, isMatch, isRecommended, onClick, compact = false }: {
  preset: PresetItem;
  isMatch: boolean;
  isRecommended: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button onClick={onClick}
      style={{
        display: "flex", alignItems: compact ? "center" : "flex-start", gap: 10,
        padding: compact ? "8px 12px" : "11px 13px",
        borderRadius: 11, fontSize: 12, textAlign: "left", cursor: "pointer",
        border: "none", width: "100%",
        background: isMatch
          ? "linear-gradient(135deg, rgba(26,86,255,0.10) 0%, rgba(99,102,241,0.07) 100%)"
          : "var(--bg-secondary)",
        outline: isMatch
          ? "1.5px solid var(--accent-border)"
          : isRecommended
            ? "0.5px solid rgba(26,86,255,0.18)"
            : "0.5px solid var(--separator)",
        transition: "all 150ms var(--ease-smooth)",
        color: "var(--text-primary)",
        position: "relative",
      }}
      onMouseEnter={e => {
        if (!isMatch) (e.currentTarget as HTMLElement).style.background =
          "linear-gradient(135deg, rgba(26,86,255,0.06) 0%, rgba(99,102,241,0.03) 100%)";
      }}
      onMouseLeave={e => {
        if (!isMatch) (e.currentTarget as HTMLElement).style.background = "var(--bg-secondary)";
      }}
    >
      <span style={{ fontSize: compact ? 16 : 20, lineHeight: 1, flexShrink: 0, marginTop: compact ? 0 : 1 }}>{p.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: compact ? 11 : 12, color: isMatch ? "var(--accent)" : "var(--text-primary)" }}>
            {p.label}
          </span>
          {p.tag && (
            <span style={{
              fontSize: 9, padding: "1px 5px", borderRadius: 4,
              background: isMatch
                ? "rgba(26,86,255,0.12)"
                : p.config.videoMode === "native"
                  ? "rgba(52,199,89,0.12)"
                  : isRecommended
                    ? "rgba(26,86,255,0.08)"
                    : "rgba(0,0,0,0.04)",
              color: isMatch
                ? "var(--accent)"
                : p.config.videoMode === "native"
                  ? "var(--green)"
                  : isRecommended ? "var(--accent)" : "var(--text-tertiary)",
            }}>
              {p.tag}
            </span>
          )}
          {isRecommended && !compact && p.rank && (
            <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4,
              background: "rgba(245,158,11,0.10)", color: "var(--orange)" }}>
              {p.rank}
            </span>
          )}
        </div>
        {!compact && p.desc && (
          <p style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 3, lineHeight: 1.5,
            overflow: "hidden", display: "-webkit-box",
            WebkitLineClamp: 1, WebkitBoxOrient: "vertical" as const }}>
            {p.desc}
          </p>
        )}
        {!compact && p.apiKeyUrl && (
          <a href={p.apiKeyUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ display: "inline-flex", alignItems: "center", gap: 3,
              fontSize: 9.5, marginTop: 4, color: "var(--accent)", textDecoration: "none" }}>
            获取 API Key <ExternalLink size={7.5} />
          </a>
        )}
      </div>
      {isMatch && (
        <div style={{
          width: 18, height: 18, borderRadius: "50%",
          background: "var(--accent)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <Check size={10} color="#fff" strokeWidth={3} />
        </div>
      )}
    </button>
  );
}
