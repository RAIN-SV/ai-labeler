"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { supabase, SUPABASE_URL, API_BASE, APP_TOKEN, apiFetch } from "../lib/supabase";
import {
  LabelFile, FileType, FileStatus,
  FILE_TYPE_ICON, FILE_TYPE_LABEL,
  detectFileType, calcFileHash,
} from "../lib/types";
import RulesPanel from "./components/RulesPanel";
import ResultModal from "./components/ResultModal";
import TokenChart from "./components/TokenChart";
import BatchExport from "./components/BatchExport";
import ModelConfigPanel, { ModelConfig, DEFAULT_CONFIG } from "./components/ModelConfigPanel";
import { useRouter } from "next/navigation";
import { ScoreBadge } from "./components/ScoreVisualize";
import LabelResultView from "./components/LabelResultView";
import {
  LayoutGrid, RefreshCw,
  AlertTriangle, Upload, Zap, BarChart2, BookOpen,
  CheckCircle2, XCircle, Loader2, ArrowUp,
  Sparkles, Layers, ArrowLeft, Pencil, X,
  Key, ChevronRight, Home as HomeIcon, Play, Pause,
} from "lucide-react";

// ─── 一级页面：四种模态入口定义 ───────────────────────────────
type ModalType = "image" | "audio" | "video" | "text";

const MODAL_ENTRIES: {
  type: ModalType;
  icon: string;
  label: string;
  desc: string;
  hint: string;
  formats: string[];
  color: string;
  gradientFrom: string;
  gradientTo: string;
  bg: string;
  accept: string;
}[] = [
  {
    type: "image", icon: "🖼️", label: "图片打标",
    desc: "商品图、摄影作品、UI 设计稿、海报",
    hint: "支持视觉描述、属性提取、质量评估",
    formats: ["JPG", "PNG", "WebP", "GIF", "SVG"],
    color: "#1A56FF",
    gradientFrom: "#1A56FF", gradientTo: "#6366F1",
    bg: "rgba(26,86,255,0.08)",
    accept: "image/*",
  },
  {
    type: "audio", icon: "🎵", label: "音频打标",
    desc: "会议录音、播客、音效、采访、音乐",
    hint: "Paraformer 转录 + 语义分析",
    formats: ["MP3", "WAV", "M4A", "OGG", "FLAC"],
    color: "#1A56FF",
    gradientFrom: "#1A56FF", gradientTo: "#6366F1",
    bg: "rgba(26,86,255,0.08)",
    accept: "audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac",
  },
  {
    type: "video", icon: "🎬", label: "视频打标",
    desc: "短视频、产品演示、监控、课程",
    hint: "关键帧提取或原生视频理解",
    formats: ["MP4", "MOV", "AVI", "MKV", "WebM"],
    color: "#1A56FF",
    gradientFrom: "#1A56FF", gradientTo: "#6366F1",
    bg: "rgba(26,86,255,0.08)",
    accept: "video/*,.mp4,.mov,.avi,.mkv,.webm",
  },
  {
    type: "text", icon: "📄", label: "文本打标",
    desc: "新闻、客服对话、代码、日志、报告",
    hint: "支持长文档分析与结构化提取",
    formats: ["TXT", "MD", "JSON", "CSV", "PY"],
    color: "#1A56FF",
    gradientFrom: "#1A56FF", gradientTo: "#6366F1",
    bg: "rgba(26,86,255,0.08)",
    accept: "text/*,.txt,.md,.csv,.json,.xml,.log,.js,.ts,.py,.html,.css",
  },
];

const ACCEPT_TYPES = [
  "image/*","audio/*","video/*","text/*",
  ".txt,.md,.csv,.json,.xml,.log,.js,.ts,.py,.html,.css",
].join(",");
const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024;

/**
 * 根据 baseUrl 自动推断 API Key 格式并校验。
 * 返回 null 表示通过；否则返回错误提示字符串。
 */
function validateApiKey(apiKey: string, baseUrl: string): string | null {
  const key = apiKey.trim();
  if (!key) return "请先填写 API Key";
  if (/\s/.test(key)) return "API Key 不能包含空格，请检查是否复制了多余字符";

  // Gemini / Google AI Studio
  if (baseUrl.includes("googleapis.com") || baseUrl.includes("generativelanguage")) {
    if (!key.startsWith("AIza"))
      return `Gemini API Key 格式错误：应以 "AIza" 开头（当前："${key.slice(0, 6)}…"）\n请前往 https://aistudio.google.com/apikey 获取正确 Key`;
    if (key.length < 30 || key.length > 50)
      return `Gemini API Key 长度异常（${key.length} 位，通常为 39 位），请重新复制`;
  }
  // OpenAI 官方
  else if (baseUrl.includes("api.openai.com")) {
    if (!key.startsWith("sk-"))
      return `OpenAI API Key 格式错误：应以 "sk-" 开头（当前："${key.slice(0, 6)}…"）`;
  }
  // 阿里云 DashScope
  else if (baseUrl.includes("dashscope.aliyuncs.com")) {
    if (!key.startsWith("sk-"))
      return `DashScope API Key 格式错误：应以 "sk-" 开头（当前："${key.slice(0, 6)}…"）`;
  }
  // Anthropic
  else if (baseUrl.includes("anthropic.com")) {
    if (!key.startsWith("sk-ant-"))
      return `Anthropic API Key 格式错误：应以 "sk-ant-" 开头`;
  }
  // 其他自定义接口：仅检查非空
  return null;
}

function getSessionId(): string {
  if (typeof window === "undefined") return `session_${Date.now()}`;
  const KEY = "ai_labeler_session_id";
  let sid = localStorage.getItem(KEY);
  if (!sid) {
    sid = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(KEY, sid);
  }
  return sid;
}

const STATUS_CFG: Record<FileStatus, { badge: string; label: string; dot: string }> = {
  pending:    { badge: "badge-pending",    label: "待处理", dot: "var(--text-quaternary)" },
  uploading:  { badge: "badge-uploading",  label: "上传中", dot: "#0A84FF" },
  processing: { badge: "badge-processing", label: "打标中", dot: "var(--orange)" },
  done:       { badge: "badge-done",       label: "完成",   dot: "var(--green)" },
  error:      { badge: "badge-error",      label: "出错",   dot: "var(--red)" },
};

export default function Home() {
  // ── 全局配置 ──
  const router = useRouter();
  const [apiKey, setApiKey]           = useState("");
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_CONFIG);
  const [isKeyTested, setIsKeyTested] = useState<null | "ok" | "fail">(null);
  const [apiKeyFormatErr, setApiKeyFormatErr] = useState<string | null>(null);

  // ── 打标规则 ──
  const [prompt, setPrompt] = useState(`请对内容进行专业打标分析，严格按以下格式输出（结果将写入导出 Excel）：

## Top3 核心标签
- 标签1（最相关）
- 标签2
- 标签3

## 质量评分
- 维度A：X/10
- 维度B：X/10
- 总分：X/10`);
  const [ruleContent, setRuleContent] = useState<Record<string, string> | null>(null);

  // ── 页面层级：null=一级选择 / "image"|"audio"|"video"|"text"=二级工作台 ──
  const [activeModal, setActiveModal] = useState<ModalType | null>(null);

  // ── 文件 & 处理状态 ──
  const [files, setFiles]             = useState<LabelFile[]>([]);
  const [isDragging, setIsDragging]   = useState(false);
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null);
  const [modalLocalId, setModalLocalId]       = useState<string | null>(null);
  const [isBatchRunning, setIsBatchRunning]   = useState(false);
  const [concurrency, setConcurrency] = useState(2);

  // ── 二级侧边工具栏 ──
  const [workTab, setWorkTab] = useState<"files" | "rules">("files");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef   = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const sessionId    = useRef(getSessionId());

  // ── 当前模态相关文件（按类型过滤，方便未来扩展；目前混合存放） ──
  const selectedFile = files.find(f => f.localId === selectedLocalId) ?? null;
  const modalFile    = files.find(f => f.localId === modalLocalId)    ?? null;
  const pendingCount    = files.filter(f => f.status === "pending").length;
  const doneCount       = files.filter(f => f.status === "done").length;
  const errorCount      = files.filter(f => f.status === "error").length;
  const processingCount = files.filter(f => f.status === "processing" || f.status === "uploading").length;

  // ── 当前进入二级页面的模态入口信息 ──
  const currentEntry = MODAL_ENTRIES.find(e => e.type === activeModal) ?? null;

  const updateFile = useCallback((localId: string, patch: Partial<LabelFile>) =>
    setFiles(prev => prev.map(f => f.localId === localId ? { ...f, ...patch } : f)), []);

  const startPolling = useCallback((localId: string, fileId: string) => {
    const interval = setInterval(async () => {
      try {
        const res  = await apiFetch(`${API_BASE}/status/${fileId}`);
        const data = await res.json();
        if (data.status === "done" && data.result) {
          clearInterval(interval); pollingRef.current.delete(localId);
          updateFile(localId, {
            status: "done", result: data.result.result?.raw ?? "",
            transcript: data.result.transcript ?? undefined,
            resultId: data.result.id,
            inputTokens: data.result.input_tokens,
            outputTokens: data.result.output_tokens,
          });
        } else if (data.status === "error") {
          clearInterval(interval); pollingRef.current.delete(localId);
          updateFile(localId, { status: "error", errorMsg: "后台处理失败" });
        }
      } catch { /* ignore */ }
    }, 3000);
    pollingRef.current.set(localId, interval);
  }, [updateFile]);

  useEffect(() => () => { pollingRef.current.forEach(i => clearInterval(i)); }, []);

  // ── Escape 关闭弹窗 ──
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") setModalLocalId(null); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  const testApiKey = async () => {
    if (!apiKey.trim()) return;
    try {
      const res = await apiFetch(`${API_BASE}/test-key`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, base_url: modelConfig.baseUrl, model: modelConfig.visionModel }),
      });
      setIsKeyTested((await res.json()).status === "ok" ? "ok" : "fail");
    } catch { setIsKeyTested("fail"); }
  };

  /** 根据文件类型获取实际使用的 prompt */
  const getEffectivePrompt = (fileType: FileType): string => {
    if (ruleContent) {
      const typed = ruleContent[fileType];
      if (typed?.trim()) return typed;
    }
    return prompt;
  };

  const handleFiles = useCallback(async (rawFiles: FileList | null) => {
    if (!rawFiles) return;
    const newItems: LabelFile[] = [];
    for (const f of Array.from(rawFiles)) {
      const hash = await calcFileHash(f);
      const dup = files.find(ef => ef.fileHash === hash);
      if (dup) { alert(`「${f.name}」与「${dup.name}」重复，已跳过`); continue; }
      newItems.push({
        id: "", localId: `${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        name: f.name, fileHash: hash,
        previewUrl: (f.type.startsWith("image/") || f.type.startsWith("video/") || f.type.startsWith("audio/"))
          ? URL.createObjectURL(f) : "",
        fileType: detectFileType(f), status: "pending" as FileStatus, _file: f,
      });
    }
    if (newItems.length > 0) {
      setFiles(prev => [...prev, ...newItems]);
      if (!selectedLocalId) setSelectedLocalId(newItems[0].localId);
    }
  }, [files, selectedLocalId]);

  const uploadToStorage = async (file: File, localId: string, fileType: FileType) => {
    updateFile(localId, { status: "uploading", uploadProgress: 0 });
    const ext  = file.name.split(".").pop() || "bin";
    const path = `${sessionId.current}/${fileType}/${Date.now()}_${Math.random().toString(36).slice(2,6)}.${ext}`;
    const { error } = await supabase.storage.from("uploads").upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) { updateFile(localId, { status: "error", errorMsg: error.message }); return null; }
    updateFile(localId, { uploadProgress: 100 });
    const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/uploads/${path}`;
    const { data: meta, error: dbErr } = await supabase.from("files_metadata")
      .insert({ session_id: sessionId.current, file_name: file.name, file_url: fileUrl, file_type: fileType, status: "pending" })
      .select("id").single();
    if (dbErr || !meta) { updateFile(localId, { status: "error", errorMsg: dbErr?.message }); return null; }
    updateFile(localId, { id: meta.id });
    return { fileId: meta.id, fileUrl };
  };

  const uploadDirect = (file: File, localId: string, fileType: FileType): Promise<string | null> => {
    updateFile(localId, { status: "uploading", uploadProgress: 0 });
    return new Promise(resolve => {
      const form = new FormData();
      const effectivePrompt = getEffectivePrompt(fileType);
      form.append("file", file); form.append("file_type", fileType);
      form.append("prompt", effectivePrompt); form.append("api_key", apiKey);
      form.append("session_id", sessionId.current); form.append("base_url", modelConfig.baseUrl);
      form.append("model", modelConfig.visionModel); form.append("text_model", modelConfig.textModel);
      form.append("video_mode", modelConfig.videoMode ?? "frames");
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/upload-and-process`);
      if (APP_TOKEN) xhr.setRequestHeader("Authorization", `Bearer ${APP_TOKEN}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) updateFile(localId, { uploadProgress: Math.round(e.loaded / e.total * 100) });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            updateFile(localId, { id: data.file_id, status: "processing", uploadProgress: 100 });
            resolve(data.file_id);
          } catch { updateFile(localId, { status: "error", errorMsg: "解析失败" }); resolve(null); }
        } else {
          let msg = "直传失败";
          try { msg = JSON.parse(xhr.responseText)?.detail || msg; } catch { /**/ }
          updateFile(localId, { status: "error", errorMsg: msg }); resolve(null);
        }
      };
      xhr.onerror = () => { updateFile(localId, { status: "error", errorMsg: "网络失败" }); resolve(null); };
      xhr.send(form);
    });
  };

  const processFile = async (localId: string, fileId: string, fileUrl: string, fileType: FileType) => {
    const effectivePrompt = getEffectivePrompt(fileType);
    updateFile(localId, { status: "processing" });
    try {
      const res = await apiFetch(`${API_BASE}/process`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId, file_url: fileUrl, file_type: fileType,
          prompt: effectivePrompt, api_key: apiKey, session_id: sessionId.current,
          base_url: modelConfig.baseUrl, model: modelConfig.visionModel, text_model: modelConfig.textModel,
          video_mode: modelConfig.videoMode ?? "frames" }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "处理失败");
      const data = await res.json();
      if (data.status === "accepted") {
        startPolling(localId, fileId);
      } else {
        let resultId: string | undefined;
        try { resultId = (await supabase.from("label_results").select("id").eq("file_id", fileId).order("created_at", { ascending: false }).limit(1).single()).data?.id; } catch { /**/ }
        updateFile(localId, { status: "done", result: data.result, resultId, inputTokens: data.tokens?.input, outputTokens: data.tokens?.output, truncated: data.truncated, originalChars: data.original_chars });
      }
    } catch (e: unknown) {
      updateFile(localId, { status: "error", errorMsg: e instanceof Error ? e.message : "未知错误" });
    }
  };

  const uploadAndProcess = async (lf: LabelFile) => {
    if (!lf._file) return;
    const isLarge = lf._file.size > LARGE_FILE_THRESHOLD && (lf.fileType === "audio" || lf.fileType === "video");
    if (isLarge) {
      const fid = await uploadDirect(lf._file, lf.localId, lf.fileType);
      if (fid) startPolling(lf.localId, fid);
    } else {
      const r = await uploadToStorage(lf._file, lf.localId, lf.fileType);
      if (r) await processFile(lf.localId, r.fileId, r.fileUrl, lf.fileType);
    }
  };

  const handleSingleProcess = async (lf: LabelFile) => {
    const keyErr = validateApiKey(apiKey, modelConfig.baseUrl);
    if (keyErr) { alert(`⚠️ API Key 校验失败\n\n${keyErr}`); return; }
    await uploadAndProcess(lf);
  };

  const handleRetry = async (lf: LabelFile) => {
    updateFile(lf.localId, { status: "pending", errorMsg: undefined, result: undefined, resultId: undefined, uploadProgress: undefined });
    const keyErr = validateApiKey(apiKey, modelConfig.baseUrl);
    if (keyErr) { alert(`⚠️ API Key 校验失败\n\n${keyErr}`); return; }
    await uploadAndProcess({ ...lf, status: "pending" } as LabelFile);
  };

  const handleRetryAll = () => {
    files.filter(f => f.status === "error" && f._file)
      .forEach(f => updateFile(f.localId, { status: "pending", errorMsg: undefined, result: undefined, uploadProgress: undefined }));
    setTimeout(() => handleBatchProcess(), 100);
  };

  const handleBatchProcess = async () => {
    const keyErr = validateApiKey(apiKey, modelConfig.baseUrl);
    if (keyErr) { alert(`⚠️ API Key 校验失败\n\n${keyErr}`); return; }
    const pending = files.filter(f => f.status === "pending");
    if (!pending.length) return;
    setIsBatchRunning(true);
    let idx = 0;
    const runNext = async (): Promise<void> => {
      if (idx >= pending.length) return;
      const lf = pending[idx++];
      if (lf._file) await uploadAndProcess(lf);
      return runNext();
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => runNext()));
    setIsBatchRunning(false);
  };

  const clearAll = () => {
    files.forEach(f => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); });
    pollingRef.current.forEach(i => clearInterval(i));
    pollingRef.current.clear();
    setFiles([]); setSelectedLocalId(null); setModalLocalId(null);
  };

  const deleteFile = (localId: string) => {
    const target = files.find(f => f.localId === localId);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    const interval = pollingRef.current.get(localId);
    if (interval != null) { clearInterval(interval); pollingRef.current.delete(localId); }
    setFiles(prev => {
      const next = prev.filter(f => f.localId !== localId);
      if (selectedLocalId === localId) {
        setSelectedLocalId(next.length > 0 ? next[0].localId : null);
      }
      return next;
    });
  };

  // ── 进入二级工作台 ──
  const enterWorkbench = (type: ModalType) => {
    setActiveModal(type);
    setWorkTab("files");
    // 重置文件列表，进入新的类型工作台
    clearAll();
  };

  // ── 返回一级选择页 ──
  const backToHome = () => {
    setActiveModal(null);
    setSelectedLocalId(null);
  };

  return (
    <div className="app-root">

      {/* ══════════════════════════════════════
          全局顶栏 — 深色品牌渐变
      ══════════════════════════════════════ */}
      <header
        style={{
          position: "sticky", top: 0, zIndex: 40, flexShrink: 0,
          display: "flex", alignItems: "center",
          gap: 0, padding: "0 0", height: 48,
          background: "linear-gradient(90deg, #0A192F 0%, #112240 60%, #0F1E38 100%)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>

        {/* Logo 区 */}
        <div style={{
          display: "flex", alignItems: "center", gap: 9,
          padding: "0 20px", height: "100%", flexShrink: 0,
          borderRight: "1px solid rgba(255,255,255,0.06)",
          minWidth: 200,
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7, display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 13,
            background: "linear-gradient(145deg, #1A56FF, #6366F1)",
            boxShadow: "0 2px 8px rgba(26,86,255,0.40), inset 0 1px 0 rgba(255,255,255,0.25)",
            cursor: activeModal ? "pointer" : "default", flexShrink: 0,
          }} onClick={() => activeModal && backToHome()}>🏷️</div>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>
              AI 打标
            </span>
            {activeModal && currentEntry && (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.40)", marginLeft: 6 }}>
                / {currentEntry.label}
              </span>
            )}
          </div>
        </div>

        {/* 模型配置按钮 */}
        <div style={{ padding: "0 12px", borderRight: "1px solid rgba(255,255,255,0.06)", height: "100%",
          display: "flex", alignItems: "center" }}>
          <ModelConfigPanel config={modelConfig} onChange={setModelConfig} currentModal={activeModal ?? undefined} />
        </div>

        {/* API Key 状态灯（仅工作台显示） */}
        {activeModal && (
          <div style={{ padding: "0 10px", height: "100%", display: "flex", alignItems: "center",
            borderRight: "1px solid rgba(255,255,255,0.06)", position: "relative" }}
            title={apiKeyFormatErr ? `格式错误: ${apiKeyFormatErr}` : apiKey.trim() ? (isKeyTested === "ok" ? "API Key 已验证" : "API Key 已填写") : "未填写 API Key，请点击配置"}
          >
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
              {/* 状态灯 */}
              <div style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                background: apiKeyFormatErr ? "#EF4444"
                  : isKeyTested === "ok" ? "#22C55E"
                  : apiKey.trim() ? "#F59E0B"
                  : "rgba(255,255,255,0.20)",
                boxShadow: apiKeyFormatErr ? "0 0 5px rgba(239,68,68,0.7)"
                  : isKeyTested === "ok" ? "0 0 5px rgba(34,197,94,0.7)"
                  : apiKey.trim() ? "0 0 5px rgba(245,158,11,0.6)"
                  : "none",
              }} />
              {/* Key 文本输入（紧凑） */}
              <input
                type="password"
                placeholder="API Key…"
                value={apiKey}
                onChange={e => {
                  const v = e.target.value;
                  setApiKey(v); setIsKeyTested(null);
                  setApiKeyFormatErr(v.trim() ? validateApiKey(v, modelConfig.baseUrl) : null);
                }}
                className="input input-dark"
                style={{
                  height: 26, width: 140, fontSize: 11, borderRadius: 7,
                  background: "rgba(255,255,255,0.06)",
                  borderColor: apiKeyFormatErr ? "rgba(239,68,68,0.4)"
                    : isKeyTested === "ok" ? "rgba(34,197,94,0.4)"
                    : undefined,
                }}
              />
              {/* 格式错误 tooltip（小角标） */}
              {apiKeyFormatErr && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50,
                  background: "rgba(20,20,30,0.96)", border: "0.5px solid rgba(239,68,68,0.35)",
                  borderRadius: 8, padding: "6px 10px", maxWidth: 260,
                  fontSize: 10, color: "#EF4444", lineHeight: 1.55, pointerEvents: "none",
                  whiteSpace: "pre-wrap",
                }}>
                  {apiKeyFormatErr}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 弹性空间 */}
        <div style={{ flex: 1 }} />

        {/* 文件统计（工作台内才显示） */}
        {files.length > 0 && (
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 16px",
            fontSize:11, color:"rgba(255,255,255,0.45)" }}>
            <span>{files.length} 文件</span>
            {processingCount > 0 && (
              <span style={{ display:"flex", alignItems:"center", gap:3, color:"#F59E0B" }}>
                <Loader2 size={10} className="anim-spin"/>{processingCount}
              </span>
            )}
            {doneCount > 0 && (
              <span style={{ display:"flex", alignItems:"center", gap:3, color:"#22C55E" }}>
                <CheckCircle2 size={10}/>{doneCount}
              </span>
            )}
            {errorCount > 0 && (
              <span style={{ display:"flex", alignItems:"center", gap:3, color:"#EF4444" }}>
                <XCircle size={10}/>{errorCount}
              </span>
            )}
          </div>
        )}

        {/* 导出按钮 */}
        <div style={{ padding: "0 16px", borderLeft: "1px solid rgba(255,255,255,0.06)", height: "100%",
          display: "flex", alignItems: "center" }}>
          <button
            onClick={() => router.push("/export")}
            className="btn"
            style={{
              borderRadius: 8, fontSize: 11, gap: 5, height: 30, padding: "0 12px",
              background: "linear-gradient(135deg, #1A56FF 0%, #6366F1 100%)",
              color: "#fff",
              boxShadow: "0 2px 8px rgba(26,86,255,0.35)",
            }}>
            <ArrowUp size={11} style={{ transform: "rotate(45deg)" }} />
            导出
            {doneCount > 0 && (
              <span style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center",
                width:16, height:16, borderRadius:"50%",
                background:"rgba(255,255,255,0.22)", fontSize:9, fontWeight:700,
              }}>{doneCount}</span>
            )}
          </button>
        </div>
      </header>

      {/* ── 全局进度条（有文件处理时显示） ── */}
      {(isBatchRunning || processingCount > 0) && files.length > 0 && (
        <div style={{ flexShrink: 0 }}>
          {/* 顶部流光细线 */}
          <div style={{ height: 3, background: "rgba(255,255,255,0.05)", position: "relative", overflow: "hidden" }}>
            <div style={{
              position: "absolute", top: 0, height: "100%",
              width: `${files.length > 0 ? Math.round((doneCount + errorCount) / files.length * 100) : 0}%`,
              background: errorCount > 0
                ? "linear-gradient(90deg, #1A56FF, #6366F1, #EF4444)"
                : "linear-gradient(90deg, #1A56FF, #6366F1, #22D3EE)",
              transition: "width 500ms ease-out",
              borderRadius: 2,
              minWidth: processingCount > 0 ? "8%" : 0,
            }}/>
            {processingCount > 0 && (
              <div style={{
                position: "absolute", top: 0, left: "-30%", width: "30%", height: "100%",
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.30), transparent)",
                animation: "progressScan 1.4s ease-in-out infinite",
              }}/>
            )}
          </div>
          {/* 文字提示条 */}
          <div style={{
            padding: "4px 16px",
            background: "rgba(10,25,47,0.95)",
            borderBottom: "1px solid rgba(26,86,255,0.15)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <Loader2 size={10} className="anim-spin" style={{ color: "#1A56FF" }}/>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>
              {processingCount > 0 ? `正在打标 · ${processingCount} 进行中` : "批量打标已完成"}
            </span>
            <span style={{ flex: 1 }}/>
            {doneCount > 0 && <span style={{ fontSize: 10, color: "#22D3EE" }}>✓ {doneCount} 完成</span>}
            {errorCount > 0 && <span style={{ fontSize: 10, color: "#EF4444" }}>✗ {errorCount} 失败</span>}
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.30)", fontVariantNumeric: "tabular-nums" }}>
              {doneCount + errorCount}/{files.length}
            </span>
          </div>
        </div>
      )}
      {!activeModal && (
        <HomeSelector onEnter={enterWorkbench} />
      )}

      {/* ══════════════════════════════════════
          二级：工作台 — 三栏式全屏布局
      ══════════════════════════════════════ */}
      {activeModal && currentEntry && (
        <div className="workbench-layout page-enter">

          {/* ── 左栏：深色导航 + 文件管理 ── */}
          <aside className="workbench-left">

            {/* 模态标题 + 返回 */}
            <div style={{
              padding: "14px 14px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              flexShrink: 0,
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <button onClick={backToHome}
                  style={{
                    width:26, height:26, padding:0, borderRadius:7, border:"none",
                    background:"rgba(255,255,255,0.08)", cursor:"pointer", flexShrink:0,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    color:"rgba(255,255,255,0.55)", transition:"background 120ms",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.14)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}>
                  <ArrowLeft size={12}/>
                </button>
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.35)", letterSpacing:"0.05em" }}>返回首页</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:9 }}>
                <div style={{
                  width:36, height:36, borderRadius:10, display:"flex", alignItems:"center",
                  justifyContent:"center", fontSize:18, flexShrink:0,
                  background:`linear-gradient(145deg, ${currentEntry.gradientFrom}30, ${currentEntry.gradientTo}18)`,
                  border:`0.5px solid ${currentEntry.gradientFrom}35`,
                }}>{currentEntry.icon}</div>
                <div>
                  <p style={{ fontSize:13, fontWeight:700, color:"#fff" }}>{currentEntry.label}</p>
                  <p style={{ fontSize:10, color:"rgba(255,255,255,0.35)", marginTop:1, lineHeight:1.4 }}>
                    {currentEntry.hint}
                  </p>
                </div>
              </div>
            </div>

            {/* Tab 切换 */}
            <div style={{ display:"flex", padding:"6px 8px 0", gap:1, borderBottom:"1px solid rgba(255,255,255,0.06)", flexShrink:0 }}>
              {([
                { id:"files" as const, icon:<Upload size={11}/>, label:"文件" },
                { id:"rules" as const, icon:<BookOpen size={11}/>, label:"规则" },
              ]).map(({ id, icon, label }) => (
                <button key={id} onClick={() => setWorkTab(id)}
                  style={{
                    flex:1, padding:"5px 0", borderRadius:"6px 6px 0 0", fontSize:11, gap:4,
                    border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
                    background: workTab===id ? "rgba(255,255,255,0.08)" : "transparent",
                    color: workTab===id ? currentEntry.color : "rgba(255,255,255,0.35)",
                    fontWeight: workTab===id ? 600 : 400,
                    borderBottom: workTab===id ? `2px solid ${currentEntry.color}` : "2px solid transparent",
                    transition:"all 150ms",
                  }}>
                  {icon}{label}
                </button>
              ))}
            </div>

            {/* 文件 Tab */}
            {workTab === "files" && (
              <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden" }} className="anim-fade">

                {/* 规则状态 */}
                <div style={{ padding:"7px 10px", borderBottom:"1px solid rgba(255,255,255,0.05)",
                  display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <BookOpen size={10} style={{ color:"rgba(255,255,255,0.30)" }}/>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.30)" }}>
                      {ruleContent ? "自定义规则" : "默认规则"}
                    </span>
                  </div>
                  <button onClick={() => setWorkTab("rules")}
                    style={{
                      padding:"2px 7px", fontSize:10, borderRadius:5, border:"0.5px solid rgba(255,255,255,0.12)",
                      background:"transparent", color:"rgba(255,255,255,0.40)", cursor:"pointer",
                    }}>
                    {ruleContent ? "修改" : "配置"}
                  </button>
                </div>

                {/* 拖拽上传区 */}
                <div style={{ padding:"8px 8px 0", flexShrink:0 }}>
                  <div className={`drop-zone ${isDragging ? "dragging" : ""}`}
                    style={{
                      border:`1.5px dashed ${isDragging ? currentEntry.color : "rgba(255,255,255,0.12)"}`,
                      borderRadius:10, padding:"14px 8px",
                      display:"flex", flexDirection:"column", alignItems:"center",
                      cursor:"pointer", textAlign:"center",
                      background: isDragging ? `${currentEntry.color}15` : "rgba(255,255,255,0.03)",
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={e => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}>
                    <div className={isDragging ? "anim-float" : ""} style={{ fontSize:20, marginBottom:3 }}>
                      {currentEntry.icon}
                    </div>
                    <p style={{ fontSize:11, color:"rgba(255,255,255,0.45)", fontWeight:500 }}>拖入或点击上传</p>
                    <input ref={fileInputRef} type="file" accept={currentEntry.accept} multiple style={{ display:"none" }}
                      onChange={e => handleFiles(e.target.files)} />
                  </div>
                </div>

                {/* 批量操作栏 */}
                {files.length > 0 && (
                  <div style={{ padding:"6px 8px 4px", flexShrink:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:5 }}>
                      <span style={{ fontSize:10, color:"rgba(255,255,255,0.30)", flexShrink:0 }}>并发</span>
                      <input type="range" min={1} max={5} value={concurrency}
                        onChange={e => setConcurrency(+e.target.value)} style={{ flex:1 }} />
                      <span style={{ fontSize:11, fontWeight:700, color: currentEntry.color, width:13 }}>{concurrency}</span>
                    </div>
                    <div style={{ display:"flex", gap:5 }}>
                      <button onClick={handleBatchProcess} disabled={isBatchRunning || pendingCount === 0}
                        style={{
                          flex:1, height:30, fontSize:11, borderRadius:8, border:"none", cursor:"pointer",
                          display:"flex", alignItems:"center", justifyContent:"center", gap:5,
                          background: `linear-gradient(135deg, ${currentEntry.gradientFrom}, ${currentEntry.gradientTo})`,
                          color:"#fff", boxShadow:`0 2px 8px ${currentEntry.color}40`,
                          opacity: (isBatchRunning || pendingCount === 0) ? 0.45 : 1,
                        }}>
                        {isBatchRunning
                          ? <><Loader2 size={10} className="anim-spin"/> {processingCount}</>
                          : <><Zap size={10}/> 批量 ({pendingCount})</>}
                      </button>
                      {errorCount > 0 && (
                        <button onClick={handleRetryAll}
                          style={{ height:30, padding:"0 9px", fontSize:11, borderRadius:8, border:"none", cursor:"pointer",
                            background:"rgba(239,68,68,0.18)", color:"#EF4444", display:"flex", alignItems:"center", gap:4 }}>
                          <RefreshCw size={10}/>{errorCount}
                        </button>
                      )}
                      <button onClick={clearAll}
                        style={{ height:30, padding:"0 9px", fontSize:11, borderRadius:8, border:"0.5px solid rgba(255,255,255,0.10)",
                          background:"transparent", color:"rgba(255,255,255,0.35)", cursor:"pointer" }}>清空</button>
                    </div>
                  </div>
                )}

                {/* 文件列表 */}
                <div style={{ flex:1, overflowY:"auto", padding:"4px 6px 8px", minHeight:0 }}>
                  {files.length === 0 ? (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                      justifyContent:"center", height:80, gap:5 }}>
                      <Layers size={18} strokeWidth={1.5} style={{ color:"rgba(255,255,255,0.20)" }}/>
                      <span style={{ fontSize:10, color:"rgba(255,255,255,0.25)" }}>暂无文件</span>
                    </div>
                  ) : files.map((lf, i) => (
                    <FileListItem key={lf.localId} lf={lf} selected={selectedLocalId === lf.localId} index={i}
                      accentColor={currentEntry.color}
                      onSelect={() => setSelectedLocalId(lf.localId)}
                      onDoubleClick={() => setModalLocalId(lf.localId)}
                      onProcess={() => handleSingleProcess(lf)}
                      onRetry={() => handleRetry(lf)}
                      onOpenModal={() => setModalLocalId(lf.localId)} />
                  ))}
                </div>
              </div>
            )}

            {/* 规则 Tab */}
            {workTab === "rules" && (
              <div style={{ flex:1, overflow:"hidden" }} className="anim-fade">
                <RulesPanel sessionId={sessionId.current} activePrompt={prompt}
                  filterType={activeModal as FileType}
                  onSelectPrompt={p => { setPrompt(p); setRuleContent(null); setWorkTab("files"); }}
                  onSelectRule={content => {
                    setRuleContent(content as Record<string, string>);
                    const fb = (content as Record<string,string>)[activeModal!] || (content as Record<string,string>).prompt || "";
                    setPrompt(fb); setWorkTab("files");
                  }} />
              </div>
            )}
          </aside>

          {/* ── 中栏 + 右栏（合在一个区域，由 main 分割） ── */}
          <div style={{ flex:1, display:"flex", overflow:"hidden", minWidth:0 }}>
            {files.length === 0 ? (
              <WorkbenchEmpty entry={currentEntry} onUploadClick={() => fileInputRef.current?.click()} />
            ) : selectedFile ? (
              <RightPanel file={selectedFile} files={files} onSelect={setSelectedLocalId}
                onOpenModal={setModalLocalId} onRetry={handleRetry} onDelete={deleteFile}
                accentColor={currentEntry.color} />
            ) : (
              <GalleryGrid files={files} onSelect={setSelectedLocalId} onOpenModal={setModalLocalId}
                accentColor={currentEntry.color} />
            )}
          </div>
        </div>
      )}

      {modalFile && (
        <ResultModal file={modalFile} onClose={() => setModalLocalId(null)}
          onResultUpdated={(lid, r) => updateFile(lid, { result: r })} />
      )}
    </div>
  );
}

/* ─── 文件列表项（深色背景版） ──────────────────────────────── */
function FileListItem({ lf, selected, index, accentColor, onSelect, onDoubleClick, onProcess, onRetry, onOpenModal }: {
  lf: LabelFile; selected: boolean; index: number; accentColor?: string;
  onSelect: () => void; onDoubleClick: () => void;
  onProcess: () => void; onRetry: () => void; onOpenModal: () => void;
}) {
  const cfg = STATUS_CFG[lf.status];
  const color = accentColor || "#1A56FF";
  return (
    <div onClick={onSelect} onDoubleClick={onDoubleClick}
      className={`dark-file-item ${selected ? "active" : ""}`}
      style={{
        position:"relative",
        border:`0.5px solid ${selected ? `${color}40` : "transparent"}`,
        animationDelay:`${index * 25}ms`, overflow:"hidden",
      }}
      title="单击预览 · 双击详情">

      {lf.status === "uploading" && (
        <div style={{ position:"absolute", bottom:0, left:0, right:0, height:1.5, background:"rgba(255,255,255,0.06)" }}>
          <div style={{ height:"100%", background:color, width:`${lf.uploadProgress ?? 0}%`,
            transition:"width 300ms", borderRadius:1 }} />
        </div>
      )}

      {/* 缩略图 */}
      {lf.fileType === "image" && lf.previewUrl ? (
        <img src={lf.previewUrl} alt={lf.name}
          style={{ width:30, height:30, objectFit:"cover", borderRadius:6,
            border:"0.5px solid rgba(255,255,255,0.10)", flexShrink:0 }} />
      ) : (
        <div style={{ width:30, height:30, borderRadius:6, flexShrink:0, display:"flex",
          alignItems:"center", justifyContent:"center", fontSize:15,
          background:"rgba(255,255,255,0.06)", border:"0.5px solid rgba(255,255,255,0.08)" }}>
          {FILE_TYPE_ICON[lf.fileType]}
        </div>
      )}

      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontSize:11, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis",
          whiteSpace:"nowrap", color:"rgba(255,255,255,0.78)", marginBottom:2 }}>{lf.name}</p>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span className={`badge ${cfg.badge}`} style={{ fontSize:"9px", padding:"1px 5px" }}>
            {lf.status === "uploading" && lf.uploadProgress != null ? `${lf.uploadProgress}%` : cfg.label}
          </span>
          {lf.truncated && <AlertTriangle size={9} style={{ color:"#F59E0B" }}/>}
        </div>
      </div>

      {lf.status === "pending" && (
        <button onClick={e => { e.stopPropagation(); onProcess(); }}
          style={{ padding:"2px 8px", fontSize:10, height:22, borderRadius:6, flexShrink:0,
            border:"none", cursor:"pointer", background:`${color}55`, color:"#fff", fontWeight:600 }}>打标</button>
      )}
      {lf.status === "processing" && <Loader2 size={12} className="anim-spin" style={{ color:"#F59E0B", flexShrink:0 }}/>}
      {lf.status === "uploading" && <ArrowUp size={12} style={{ color:"#60A5FA", flexShrink:0 }}/>}
      {lf.status === "done" && (
        <button onClick={e => { e.stopPropagation(); onOpenModal(); }}
          style={{ padding:"2px 7px", fontSize:10, height:22, borderRadius:6, flexShrink:0,
            border:"0.5px solid rgba(255,255,255,0.14)", cursor:"pointer",
            background:"rgba(255,255,255,0.08)", color:"rgba(255,255,255,0.65)", display:"flex", alignItems:"center", gap:3 }}>
          <ScoreBadge result={lf.result} />
          详情
        </button>
      )}
      {lf.status === "error" && (
        <button onClick={e => { e.stopPropagation(); onRetry(); }}
          style={{ padding:"2px 7px", fontSize:10, height:22, borderRadius:6, flexShrink:0,
            border:"none", cursor:"pointer", background:"rgba(239,68,68,0.22)", color:"#EF4444" }}>
          <RefreshCw size={9}/>
        </button>
      )}
    </div>
  );
}

/* ─── RightPanel — 中栏(媒体) + 右栏(结果) ─────────────────── */
function RightPanel({ file, files, onSelect, onOpenModal, onRetry, onDelete, accentColor }: {
  file: LabelFile; files: LabelFile[];
  onSelect: (id: string) => void; onOpenModal: (id: string) => void;
  onRetry: (lf: LabelFile) => void;
  onDelete?: (localId: string) => void;
  accentColor?: string;
}) {
  const isProcessing = file.status === "uploading" || file.status === "processing";
  const cfg = STATUS_CFG[file.status];
  const accent = accentColor || "var(--accent)";

  return (
    <div style={{ display:"flex", flex:1, overflow:"hidden", minWidth:0 }}>

      {/* ══ 中栏：媒体预览区 ══ */}
      <div style={{
        flex:1, display:"flex", flexDirection:"column",
        background:"#0D1117", overflow:"hidden", minWidth:0, position:"relative",
      }}>
        {/* 顶部文件名条 */}
        <div style={{ padding:"10px 16px", borderBottom:"1px solid rgba(255,255,255,0.06)",
          display:"flex", alignItems:"center", gap:10, flexShrink:0,
          background:"rgba(255,255,255,0.03)" }}>
          <span style={{ fontSize:15 }}>{FILE_TYPE_ICON[file.fileType]}</span>
          <p style={{ fontSize:12, fontWeight:600, color:"rgba(255,255,255,0.80)",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{file.name}</p>
          <span className={`badge ${cfg.badge}`} style={{ fontSize:"10px", flexShrink:0 }}>{cfg.label}</span>
          {(file.inputTokens || file.outputTokens) && (
            <span style={{ fontSize:10, color:"rgba(255,255,255,0.30)", flexShrink:0,
              fontVariantNumeric:"tabular-nums" }}>
              {((file.inputTokens ?? 0) + (file.outputTokens ?? 0)).toLocaleString()} tok
            </span>
          )}
        </div>

        {/* 媒体展示区 */}
        <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center",
          padding:24, overflow:"hidden", position:"relative" }}>

          {/* 图片 */}
          {file.fileType === "image" && file.previewUrl && (
            <div style={{ position:"relative", maxWidth:"100%", maxHeight:"100%" }} className="anim-scale">
              <img src={file.previewUrl} alt={file.name}
                style={{ maxWidth:"100%", maxHeight:"calc(100vh - 200px)", objectFit:"contain",
                  borderRadius:14, boxShadow:"0 8px 40px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)" }} />
              {isProcessing && (
                <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
                  alignItems:"center", justifyContent:"center", gap:12, borderRadius:14,
                  background:"rgba(0,0,0,0.55)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)" }}>
                  <Loader2 size={24} className="anim-spin" style={{ color:"#fff" }}/>
                  <p style={{ fontSize:12, color:"rgba(255,255,255,0.75)" }}>
                    {file.status === "uploading" ? `上传中 ${file.uploadProgress ?? 0}%` : "AI 分析中…"}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 视频 */}
          {file.fileType === "video" && file.previewUrl && (
            <div style={{ width:"100%", maxWidth:760 }} className="anim-scale">
              <video src={file.previewUrl} controls
                style={{ width:"100%", maxHeight:"calc(100vh - 200px)", borderRadius:12,
                  background:"#000", outline:"none",
                  boxShadow:"0 8px 40px rgba(0,0,0,0.6)" }} />
              {isProcessing && (
                <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:10,
                  padding:"7px 14px", borderRadius:20, background:"rgba(245,158,11,0.15)",
                  border:"0.5px solid rgba(245,158,11,0.30)",
                  fontSize:11, color:"#F59E0B" }}>
                  <Loader2 size={10} className="anim-spin"/>视频处理中，可先播放预览
                </div>
              )}
            </div>
          )}

          {/* 视频无预览（处理中占位） */}
          {file.fileType === "video" && !file.previewUrl && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:20 }}>
              <div style={{ width:100, height:100, borderRadius:24, background:"rgba(48,209,88,0.12)",
                border:"1px solid rgba(48,209,88,0.25)", display:"flex", alignItems:"center",
                justifyContent:"center", fontSize:44 }} className="anim-float">🎬</div>
              {isProcessing && (
                <div style={{ display:"flex", alignItems:"center", gap:8,
                  fontSize:12, color:"rgba(255,255,255,0.45)" }}>
                  <Loader2 size={14} className="anim-spin"/>
                  {file.status === "uploading" ? `上传中 ${file.uploadProgress ?? 0}%` : "AI 视频分析中…"}
                </div>
              )}
            </div>
          )}

          {/* 音频 */}
          {file.fileType === "audio" && (
            <div style={{ width:"100%", maxWidth:480, display:"flex", flexDirection:"column",
              alignItems:"center", gap:20 }} className="anim-fade-up">
              {/* 动态波形可视化 */}
              <div style={{
                width:"100%", height:140, borderRadius:20,
                background:"linear-gradient(160deg, rgba(26,86,255,0.15) 0%, rgba(99,102,241,0.08) 100%)",
                border:"1px solid rgba(26,86,255,0.20)",
                display:"flex", alignItems:"center", justifyContent:"center",
                position:"relative", overflow:"hidden", gap:2, padding:"0 20px",
              }}>
                {/* 动态波形条 */}
                {Array.from({length:40}, (_,i) => (
                  <div key={i} style={{
                    width:4, borderRadius:3,
                    height:`${22 + Math.abs(Math.sin(i * 0.8)) * 55}%`,
                    background:`linear-gradient(180deg, rgba(99,102,241,${0.3 + Math.abs(Math.sin(i * 0.5)) * 0.5}) 0%, rgba(26,86,255,${0.6 + Math.abs(Math.sin(i * 0.5)) * 0.35}) 100%)`,
                    animation: isProcessing ? `waveBar ${0.8 + (i % 5) * 0.15}s ease-in-out ${(i * 0.05) % 0.8}s infinite` : "none",
                    transformOrigin:"bottom",
                    transition:"height 300ms",
                    flexShrink:0,
                  }}/>
                ))}
                <div style={{ position:"absolute", bottom:10, left:0, right:0, textAlign:"center",
                  fontSize:10, color:"rgba(255,255,255,0.30)", letterSpacing:"0.06em" }}>
                  {isProcessing ? "ANALYZING AUDIO…" : "AUDIO WAVEFORM"}
                </div>
              </div>
              {/* 原生播放器 */}
              {file.previewUrl && (
                <audio controls src={file.previewUrl}
                  style={{ width:"100%", borderRadius:10, colorScheme:"dark" }} />
              )}
              {isProcessing && (
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 18px",
                  borderRadius:20, background:"rgba(26,86,255,0.15)",
                  border:"0.5px solid rgba(26,86,255,0.25)" }}>
                  <Loader2 size={12} className="anim-spin" style={{ color:"#818CF8" }}/>
                  <span style={{ fontSize:11, color:"#818CF8" }}>Paraformer 转录中…</span>
                </div>
              )}
              {/* 转录文本 */}
              {file.transcript && (
                <div style={{ width:"100%", borderRadius:14, padding:"14px 16px",
                  background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)",
                  maxHeight:160, overflowY:"auto" }}>
                  <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.35)",
                    marginBottom:8, letterSpacing:"0.06em" }}>🎙 TRANSCRIPT</div>
                  <p style={{ fontSize:12, lineHeight:1.8, color:"rgba(255,255,255,0.65)",
                    whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{file.transcript}</p>
                </div>
              )}
            </div>
          )}

          {/* 文本 */}
          {file.fileType === "text" && (
            <div style={{ width:"100%", height:"100%", display:"flex", flexDirection:"column",
              maxWidth:700 }} className="anim-fade-up">
              <div style={{ flex:1, overflowY:"auto", borderRadius:14, padding:"16px 18px",
                background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)",
                fontSize:12.5, lineHeight:1.9, color:"rgba(255,255,255,0.65)",
                whiteSpace:"pre-wrap", wordBreak:"break-word",
                fontFamily:'"SF Mono",Menlo,monospace' }}>
                {file.transcript || (
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                    justifyContent:"center", height:"100%", gap:12 }}>
                    <span style={{ fontSize:40 }}>📄</span>
                    <p style={{ fontSize:12, color:"rgba(255,255,255,0.25)" }}>{file.name}</p>
                    {isProcessing && (
                      <div style={{ display:"flex", alignItems:"center", gap:6,
                        fontSize:11, color:"rgba(255,255,255,0.40)" }}>
                        <Loader2 size={12} className="anim-spin"/>解析中…
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 无预览 */}
          {file.fileType !== "image" && file.fileType !== "video" && file.fileType !== "audio" && file.fileType !== "text" && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
              <div className="anim-float" style={{ width:100, height:100, borderRadius:24, fontSize:48,
                display:"flex", alignItems:"center", justifyContent:"center",
                background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.10)" }}>
                {FILE_TYPE_ICON[file.fileType]}
              </div>
              <p style={{ fontSize:13, color:"rgba(255,255,255,0.40)" }}>{file.name}</p>
            </div>
          )}
        </div>

        {/* 底部胶片条 */}
        <div style={{ flexShrink:0, display:"flex", gap:5, overflowX:"auto",
          padding:"8px 14px", borderTop:"1px solid rgba(255,255,255,0.05)",
          background:"rgba(255,255,255,0.02)" }}>
          {files.map(f => {
            const fcfg = STATUS_CFG[f.status];
            const isActive = f.localId === file.localId;
            return (
              <div key={f.localId} onClick={() => onSelect(f.localId)} onDoubleClick={() => onOpenModal(f.localId)}
                className={`filmstrip-item ${isActive ? "active" : ""}`}
                style={{ position:"relative", flexShrink:0, cursor:"pointer", width:40, height:40,
                  borderRadius:8, overflow:"hidden",
                  border:`1.5px solid ${isActive ? accent : "rgba(255,255,255,0.08)"}`,
                  background:"rgba(255,255,255,0.06)" }}>
                {f.fileType === "image" && f.previewUrl ? (
                  <img src={f.previewUrl} alt={f.name} style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
                ) : (
                  <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center",
                    justifyContent:"center", fontSize:15 }}>
                    {FILE_TYPE_ICON[f.fileType]}
                  </div>
                )}
                <div style={{ position:"absolute", bottom:2, right:2, width:5, height:5,
                  borderRadius:"50%", background:fcfg.dot, border:"1px solid rgba(0,0,0,0.6)" }}/>
                {onDelete && (
                  <button onClick={e => { e.stopPropagation(); onDelete(f.localId); }}
                    title="删除" className="filmstrip-delete"
                    style={{ position:"absolute", top:1, right:1, width:13, height:13,
                      borderRadius:"50%", background:"rgba(239,68,68,0.90)",
                      border:"1.5px solid rgba(255,255,255,0.8)",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      cursor:"pointer", padding:0, boxShadow:"0 1px 3px rgba(0,0,0,0.4)",
                      opacity: isActive ? 1 : 0, transition:"opacity 120ms", zIndex:2 }}>
                    <X size={7} color="#fff" strokeWidth={3}/>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ══ 右栏：打标结果可视化 ══ */}
      <div className="workbench-right">
        {/* 结果头部 */}
        <div style={{ padding:"12px 16px", borderBottom:"0.5px solid var(--separator)",
          flexShrink:0, background:"linear-gradient(160deg, var(--bg-white) 0%, var(--bg-secondary) 100%)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:6, height:6, borderRadius:"50%",
              background: file.status === "done" ? "var(--green)"
                : isProcessing ? "var(--orange)" : "var(--text-quaternary)" }} />
            <span style={{ fontSize:11, fontWeight:700, color:"var(--text-primary)",
              letterSpacing:"0.01em" }}>打标结果</span>
            {file.status === "done" && (
              <span style={{ fontSize:10, color:"var(--text-tertiary)", marginLeft:4 }}>
                {((file.inputTokens ?? 0) + (file.outputTokens ?? 0)).toLocaleString()} tokens
              </span>
            )}
          </div>
        </div>

        {/* 结果内容 */}
        <div style={{ flex:1, overflowY:"auto", padding:"14px 16px",
          display:"flex", flexDirection:"column", gap:14 }}>

          {isProcessing && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", height:200, gap:16 }}>
              <div className="anim-breathe" style={{ width:48, height:48, borderRadius:"50%",
                background:"var(--accent-subtle)", border:"1.5px solid var(--accent-border)",
                display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Loader2 size={20} className="anim-spin" style={{ color:"var(--accent)" }}/>
              </div>
              <div style={{ textAlign:"center" }}>
                <p style={{ fontSize:13, fontWeight:600, color:"var(--text-primary)", marginBottom:4 }}>
                  {file.status === "uploading" ? "上传中" : "AI 分析中"}
                </p>
                <p style={{ fontSize:11, color:"var(--text-tertiary)" }}>
                  {file.status === "uploading" ? `${file.uploadProgress ?? 0}% 已上传` : "正在深度理解内容…"}
                </p>
              </div>
            </div>
          )}

          {file.truncated && (
            <div style={{ borderRadius:9, padding:"7px 10px", fontSize:11,
              display:"flex", alignItems:"center", gap:6,
              background:"var(--orange-subtle)", color:"var(--orange)" }}>
              <AlertTriangle size={11} style={{ flexShrink:0 }}/>
              <span>原文已截断至前 6,000 字符</span>
            </div>
          )}

          {file.status === "done" && file.result && (
            <LabelResultView result={file.result} compact />
          )}

          {file.status === "error" && (
            <div className="anim-fade">
              <div style={{ borderRadius:10, padding:"10px 12px", fontSize:12,
                background:"var(--red-subtle)", color:"var(--red)",
                border:"0.5px solid rgba(239,68,68,0.20)", lineHeight:1.6 }}>{file.errorMsg}</div>
              <button onClick={() => onRetry(file)}
                style={{ width:"100%", marginTop:8, height:32, borderRadius:9, fontSize:12,
                  border:"none", cursor:"pointer", background:"var(--red-subtle)", color:"var(--red)",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                <RefreshCw size={11}/> 重新尝试
              </button>
            </div>
          )}

          {file.status === "pending" && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", height:200, gap:12 }}>
              <div style={{ width:52, height:52, borderRadius:"50%", background:"var(--bg-secondary)",
                display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Sparkles size={22} strokeWidth={1.5} style={{ color:"var(--text-tertiary)" }}/>
              </div>
              <p style={{ fontSize:12, color:"var(--text-tertiary)" }}>点击「打标」开始 AI 分析</p>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        {file.status === "done" && file.result && (
          <div style={{ padding:"12px 14px", borderTop:"0.5px solid var(--separator)",
            flexShrink:0, display:"flex", gap:8 }}>
            <button onClick={() => onOpenModal(file.localId)}
              style={{ flex:1, height:36, borderRadius:10, fontSize:12, border:"none", cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                background:"linear-gradient(135deg, var(--accent) 0%, #6366F1 100%)",
                color:"#fff", boxShadow:"0 4px 14px rgba(26,86,255,0.28)" }}>
              <Pencil size={12}/> 查看完整 / 编辑
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Gallery（多选/批量视图） ─────────────────────────────── */
function GalleryGrid({ files, onSelect, onOpenModal, accentColor }: {
  files: LabelFile[]; onSelect: (id: string) => void; onOpenModal: (id: string) => void;
  accentColor?: string;
}) {
  return (
    <div style={{ flex:1, overflowY:"auto", padding:"28px",
      background:"linear-gradient(160deg, var(--bg-secondary) 0%, var(--bg) 100%)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:24 }}>
        <LayoutGrid size={14} style={{ color:"var(--text-tertiary)" }}/>
        <span style={{ fontSize:14, fontWeight:700, letterSpacing:"-0.02em" }}>全部文件</span>
        <span style={{ fontSize:11, color:"var(--text-tertiary)",
          background:"var(--bg-tertiary)", padding:"1px 7px", borderRadius:10 }}>{files.length}</span>
      </div>
      <div style={{ display:"grid", gap:14,
        gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))" }}>
        {files.map((f, i) => {
          const cfg = STATUS_CFG[f.status];
          return (
            <div key={f.localId} className="gallery-card anim-fade-up"
              onClick={() => onSelect(f.localId)}
              onDoubleClick={() => f.status === "done" && onOpenModal(f.localId)}
              style={{ cursor:"pointer", animationDelay:`${i * 18}ms` }} title={f.name}>
              <div style={{ aspectRatio:"1 / 1", overflow:"hidden", display:"flex",
                alignItems:"center", justifyContent:"center", position:"relative",
                background:"var(--bg-secondary)" }}>
                {f.fileType === "image" && f.previewUrl ? (
                  <img src={f.previewUrl} alt={f.name}
                    style={{ width:"100%", height:"100%", objectFit:"cover",
                      transition:"transform 350ms var(--ease-smooth)" }}
                    onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.07)")}
                    onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}/>
                ) : (
                  <span style={{ fontSize:48 }}>{FILE_TYPE_ICON[f.fileType]}</span>
                )}
                {(f.status === "uploading" || f.status === "processing") && (
                  <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center",
                    justifyContent:"center", background:"rgba(255,255,255,0.72)",
                    backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)" }}>
                    <Loader2 size={22} className="anim-spin" style={{ color:accentColor||"var(--accent)" }}/>
                  </div>
                )}
                {f.status === "done" && (
                  <div style={{ position:"absolute", top:6, right:6, width:16, height:16,
                    borderRadius:"50%", background:"var(--green)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    boxShadow:"0 1px 4px rgba(0,0,0,0.25)" }}>
                    <CheckCircle2 size={9} color="#fff" strokeWidth={2.5}/>
                  </div>
                )}
              </div>
              <div style={{ padding:"10px 12px" }}>
                <p style={{ fontSize:12, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis",
                  whiteSpace:"nowrap", marginBottom:4 }}>{f.name}</p>
                <span className={`badge ${cfg.badge}`} style={{ fontSize:"10px", padding:"1px 6px" }}>{cfg.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   一级首页：四大模态入口选择（深蓝主题版）
═══════════════════════════════════════════════════════════ */
function HomeSelector({ onEnter }: { onEnter: (type: ModalType) => void }) {
  const [homeTab, setHomeTab] = useState<"label" | "stats">("label");

  // 网格线配置（确定性，无 Hydration 差异）
  const gridDots = useMemo(() =>
    Array.from({ length: 120 }, (_, i) => ({
      id: i,
      x: (i % 12) * 8.5 + 1,
      y: Math.floor(i / 12) * 10 + 2,
      opacity: 0.04 + (i % 7) * 0.012,
    })), []);

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "row",
      overflowY: "hidden", position: "relative",
      background: "linear-gradient(160deg, #0A192F 0%, #0F2247 40%, #0A1A35 100%)",
    }}>

      {/* ── 背景装饰 ── */}
      <div style={{ position:"absolute", inset:0, overflow:"hidden", pointerEvents:"none", zIndex:0 }}>
        <svg width="100%" height="100%" style={{ position:"absolute", inset:0, opacity:0.35 }}>
          {gridDots.map(d => (
            <circle key={d.id} cx={`${d.x}%`} cy={`${d.y}%`} r="1" fill={`rgba(26,86,255,${d.opacity})`} />
          ))}
        </svg>
        <div style={{ position:"absolute", width:500, height:500, borderRadius:"50%",
          background:"radial-gradient(circle, rgba(26,86,255,0.12) 0%, transparent 70%)",
          top:"-10%", left:"-5%", filter:"blur(60px)" }} />
        <div style={{ position:"absolute", width:400, height:400, borderRadius:"50%",
          background:"radial-gradient(circle, rgba(99,102,241,0.10) 0%, transparent 70%)",
          bottom:"-5%", right:"-5%", filter:"blur(50px)" }} />
      </div>

      {/* ── T5: 左侧竖向 Tab 导航 ── */}
      <nav style={{
        width: 68, flexShrink: 0, zIndex: 2,
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: 48, gap: 6,
        background: "rgba(0,0,0,0.18)",
        borderRight: "0.5px solid rgba(255,255,255,0.06)",
      }}>
        {([
          { id:"label" as const, icon:<Sparkles size={17}/>, label:"打标" },
          { id:"stats" as const, icon:<BarChart2 size={17}/>, label:"统计" },
        ]).map(tab => (
          <button key={tab.id} onClick={() => setHomeTab(tab.id)}
            style={{
              width: 50, display: "flex", flexDirection: "column", alignItems: "center",
              gap: 5, padding: "11px 0", borderRadius: 13, border: "none", cursor: "pointer",
              background: homeTab === tab.id ? "rgba(26,86,255,0.22)" : "transparent",
              color: homeTab === tab.id ? "#fff" : "rgba(255,255,255,0.30)",
              transition: "all 180ms",
              outline: homeTab === tab.id ? "0.5px solid rgba(26,86,255,0.35)" : "none",
            }}
            onMouseEnter={e => { if (homeTab !== tab.id) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
            onMouseLeave={e => { if (homeTab !== tab.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            {tab.icon}
            <span style={{ fontSize: 9.5, fontWeight: homeTab === tab.id ? 700 : 400, letterSpacing: "0.02em" }}>
              {tab.label}
            </span>
          </button>
        ))}
      </nav>

      {/* ── 右侧主内容区 ── */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
        overflowY: "auto", zIndex: 2, position: "relative",
      }}>

        {/* 标题区 */}
        <div style={{ width: "100%", maxWidth: 900, padding: "44px 48px 0" }}>
          <div className="anim-fade-up" style={{ textAlign: "center", marginBottom: 36 }}>
            {/* 品牌标签 */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 12px",
              borderRadius: 20, background: "rgba(26,86,255,0.12)",
              border: "0.5px solid rgba(26,86,255,0.25)",
              fontSize: 10.5, fontWeight: 700, color: "rgba(100,140,255,0.85)",
              marginBottom: 16, letterSpacing: "0.08em",
            }}>
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#4D7FFF",
                display: "inline-block", boxShadow: "0 0 5px #4D7FFF" }}/>
              MULTIMODAL AI LABELING
            </div>
            {/* 精简主标题 */}
            <h1 style={{
              fontSize: 40, fontWeight: 900, letterSpacing: "-0.04em",
              lineHeight: 1.1, marginBottom: 12,
            }}>
              <span style={{
                background: "linear-gradient(135deg, #fff 0%, #c7d4ff 60%, #a78bfa 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              }}>
                AI 智能打标
              </span>
            </h1>
            {/* 文字描述紧跟主标题 */}
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.7, marginBottom: 0 }}>
              图片 · 音频 · 视频 · 文本，四种模态一键分析 · 批量导出
            </p>
          </div>
        </div>

        {/* Tab 内容 */}
        <div style={{ width: "100%", maxWidth: 900, padding: "0 48px 56px", flex: 1 }}>

          {/* 四个模态入口 — 横向并排 */}
          {homeTab === "label" && (
            <div className="anim-fade">
              {/* 横向 4 列 */}
              <div style={{ display: "flex", gap: 14 }}>
                {MODAL_ENTRIES.map((entry, i) => (
                  <div key={entry.type}
                    className="anim-fade-up"
                    onClick={() => onEnter(entry.type)}
                    style={{
                      animationDelay: `${i * 60}ms`, cursor: "pointer",
                      flex: 1,
                      display: "flex", flexDirection: "column", alignItems: "center",
                      padding: "28px 20px 24px",
                      borderRadius: 18, overflow: "hidden",
                      background: "rgba(255,255,255,0.04)",
                      border: "0.5px solid rgba(255,255,255,0.08)",
                      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                      transition: "all 220ms var(--ease-smooth)",
                      position: "relative", minHeight: 180,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                      e.currentTarget.style.borderColor = `${entry.gradientFrom}50`;
                      e.currentTarget.style.transform = "translateY(-6px)";
                      e.currentTarget.style.boxShadow = `0 16px 40px ${entry.gradientFrom}22`;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "none";
                    }}>

                    {/* 顶部渐变横线 */}
                    <div style={{
                      position: "absolute", top: 0, left: 0, right: 0, height: 2.5,
                      background: `linear-gradient(90deg, ${entry.gradientFrom}, ${entry.gradientTo})`,
                      opacity: 0.75,
                    }} />

                    {/* icon */}
                    <div style={{
                      width: 52, height: 52, borderRadius: 15, fontSize: 24,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      marginBottom: 14,
                      background: `linear-gradient(145deg, ${entry.gradientFrom}28, ${entry.gradientTo}14)`,
                      border: `0.5px solid ${entry.gradientFrom}35`,
                      boxShadow: `0 4px 16px ${entry.gradientFrom}22`,
                    }}>
                      {entry.icon}
                    </div>

                    {/* 标题 */}
                    <h3 style={{
                      fontSize: 14, fontWeight: 700, color: "#fff",
                      letterSpacing: "-0.02em", marginBottom: 6, textAlign: "center",
                    }}>{entry.label}</h3>

                    {/* hint */}
                    <p style={{
                      fontSize: 10.5, color: "rgba(255,255,255,0.32)", lineHeight: 1.5,
                      textAlign: "center", flex: 1,
                    }}>
                      {entry.hint}
                    </p>

                    {/* 底部箭头 */}
                    <div style={{
                      width: 30, height: 30, borderRadius: 9, marginTop: 14,
                      background: `linear-gradient(145deg, ${entry.gradientFrom}BB, ${entry.gradientTo}BB)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: `0 2px 8px ${entry.gradientFrom}38`,
                    }}>
                      <ChevronRight size={14} color="#fff" strokeWidth={2.5} />
                    </div>
                  </div>
                ))}
              </div>

              {/* 步骤提示条 */}
              <div style={{
                display: "flex", gap: 0, marginTop: 20,
                background: "rgba(255,255,255,0.03)",
                borderRadius: 14, border: "0.5px solid rgba(255,255,255,0.06)",
                overflow: "hidden",
              }} className="anim-fade-up">
                {[
                  { n: "01", t: "配置 API Key", sub: "顶栏填写" },
                  { n: "02", t: "选择模态类型", sub: "四种入口" },
                  { n: "03", t: "批量上传打标", sub: "AI 自动分析" },
                  { n: "04", t: "结果导出", sub: "Excel / JSON" },
                ].map(({ n, t, sub }, idx, arr) => (
                  <div key={n} style={{
                    flex: 1, padding: "12px 8px", textAlign: "center",
                    borderRight: idx < arr.length - 1 ? "0.5px solid rgba(255,255,255,0.05)" : "none",
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#4D7FFF", opacity: 0.7,
                      marginBottom: 3, letterSpacing: "0.06em" }}>{n}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.70)",
                      marginBottom: 2 }}>{t}</div>
                    <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.25)" }}>{sub}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 消耗统计 */}
          {homeTab === "stats" && (
            <div className="anim-fade" style={{
              background: "rgba(255,255,255,0.04)", borderRadius: 20,
              border: "0.5px solid rgba(255,255,255,0.08)",
              padding: "24px",
              backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            }}>
              <TokenChart />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   二级工作台：空状态（深色中栏版）
═══════════════════════════════════════════════════════════ */
function WorkbenchEmpty({ entry, onUploadClick }: {
  entry: typeof MODAL_ENTRIES[number]; onUploadClick: () => void;
}) {
  return (
    <div style={{
      flex:1, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      gap:24, padding:48, textAlign:"center",
      background:"linear-gradient(160deg, #0D1117 0%, #161B22 50%, #0D1117 100%)",
      position:"relative", overflow:"hidden",
    }}>
      {/* 背景光晕 */}
      <div style={{ position:"absolute", width:300, height:300, borderRadius:"50%",
        background:`radial-gradient(circle, ${entry.gradientFrom}20 0%, transparent 70%)`,
        top:"20%", left:"30%", filter:"blur(40px)", pointerEvents:"none" }} />

      <div className="anim-fade-up" style={{
        width:80, height:80, borderRadius:22, fontSize:38,
        display:"flex", alignItems:"center", justifyContent:"center",
        background:`linear-gradient(145deg, ${entry.gradientFrom}25, ${entry.gradientTo}12)`,
        border:`1px solid ${entry.gradientFrom}30`,
        boxShadow:`0 8px 30px ${entry.gradientFrom}20`,
        position:"relative", zIndex:1,
      }}>
        {entry.icon}
      </div>
      <div className="anim-fade-up" style={{ animationDelay:"60ms", position:"relative", zIndex:1 }}>
        <h2 style={{ fontSize:20, fontWeight:800, color:"#fff", marginBottom:8, letterSpacing:"-0.03em" }}>
          {entry.label}
        </h2>
        <p style={{ fontSize:13, color:"rgba(255,255,255,0.45)", lineHeight:1.7, maxWidth:300 }}>
          {entry.desc}
        </p>
      </div>
      <button onClick={onUploadClick} className="anim-fade-up"
        style={{
          padding:"12px 30px", fontSize:14, fontWeight:700, borderRadius:14,
          border:"none", cursor:"pointer", position:"relative", zIndex:1,
          background:`linear-gradient(135deg, ${entry.gradientFrom}, ${entry.gradientTo})`,
          color:"#fff", boxShadow:`0 4px 20px ${entry.gradientFrom}50`,
          animationDelay:"120ms", display:"flex", alignItems:"center", gap:8,
          transition:"transform 160ms, box-shadow 160ms",
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 28px ${entry.gradientFrom}60`; }}
        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 4px 20px ${entry.gradientFrom}50`; }}>
        <Upload size={15}/> 上传文件开始打标
      </button>
    </div>
  );
}

