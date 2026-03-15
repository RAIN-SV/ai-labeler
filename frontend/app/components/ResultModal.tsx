"use client";

import { useState } from "react";
import { X, Pencil, Check, Download, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import { LabelFile, FILE_TYPE_ICON, FILE_TYPE_LABEL } from "../../lib/types";
import { API_BASE, apiFetch } from "../../lib/supabase";
import LabelResultView from "./LabelResultView";

const STATUS_LABELS: Record<string, { badge: string; label: string }> = {
  pending:    { badge: "badge-pending",    label: "待处理" },
  uploading:  { badge: "badge-uploading",  label: "上传中" },
  processing: { badge: "badge-processing", label: "打标中" },
  done:       { badge: "badge-done",       label: "完成"   },
  error:      { badge: "badge-error",      label: "出错"   },
};

interface Props {
  file: LabelFile;
  onClose: () => void;
  onResultUpdated: (localId: string, newResult: string) => void;
}

export default function ResultModal({ file, onClose, onResultUpdated }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText]   = useState(file.result ?? "");
  const [saving, setSaving]       = useState(false);
  const cfg = STATUS_LABELS[file.status] ?? STATUS_LABELS.pending;

  const handleSave = async () => {
    if (!file.resultId) return;
    setSaving(true);
    try {
      await apiFetch(`${API_BASE}/results/${file.resultId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: { raw: editText } }),
      });
      onResultUpdated(file.localId, editText);
      setIsEditing(false);
    } catch { /* ignore */ }
    setSaving(false);
  };

  /* ── Excel 导出（含人工校验空列） ── */
  const handleExport = () => {
    const rows = [{
      文件名: file.name,
      "【校验_文件名】": "",
      文件类型: FILE_TYPE_LABEL[file.fileType],
      "【校验_类型】": "",
      状态: cfg.label,
      打标结果: file.result ?? "",
      "【校验_打标结果】": "",
      转录文本: file.transcript ?? "",
      "【校验_转录文本】": "",
      Input_Tokens:  file.inputTokens  ?? 0,
      Output_Tokens: file.outputTokens ?? 0,
      合计_Tokens:   (file.inputTokens ?? 0) + (file.outputTokens ?? 0),
    }];
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 30 }, { wch: 16 },
      { wch: 8  }, { wch: 16 },
      { wch: 8  },
      { wch: 80 }, { wch: 40 },
      { wch: 60 }, { wch: 40 },
      { wch: 12 }, { wch: 12 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "打标结果");
    XLSX.writeFile(wb, `label_${file.name.replace(/\.[^.]+$/, "")}.xlsx`);
  };

  const isWide = file.fileType === "image" || file.fileType === "video";

  return (
    <div className="modal-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="modal-body anim-scale"
        style={{
          position: "relative", width: "100%", maxWidth: 1040,
          display: "flex", flexDirection: "column",
          borderRadius: 22, overflow: "hidden",
          background: "var(--bg-white)",
          border: "0.5px solid rgba(0,0,0,0.12)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.35), 0 8px 20px rgba(0,0,0,0.18)",
          maxHeight: "90vh",
        }}>

        {/* 顶部渐变线 */}
        <div style={{ height: 2.5, width: "100%", flexShrink: 0,
          background: "linear-gradient(90deg, #1A56FF, #6366F1, #C084FC)" }} />

        {/* 头部 */}
        <div style={{ display: "flex", alignItems: "center",
          padding: "10px 16px", borderBottom: "0.5px solid var(--separator)", flexShrink: 0,
          background: "linear-gradient(180deg, var(--bg-white), var(--bg-secondary))" }}>

          {/* 文件信息 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, display: "flex",
              alignItems: "center", justifyContent: "center", fontSize: 17,
              background: "var(--bg-secondary)", border: "0.5px solid var(--separator)", flexShrink: 0 }}>
              {FILE_TYPE_ICON[file.fileType]}
            </div>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>{file.name}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <span className={`badge ${cfg.badge}`} style={{ fontSize: "10px" }}>{cfg.label}</span>
                {file.truncated && (
                  <span style={{ display: "flex", alignItems: "center", gap: 3,
                    fontSize: 10, color: "var(--orange)" }}>
                    <AlertTriangle size={9} /> 已截断
                  </span>
                )}
                {(file.inputTokens || file.outputTokens) && (
                  <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                    {((file.inputTokens ?? 0) + (file.outputTokens ?? 0)).toLocaleString()} tokens
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 右侧操作 */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 12 }}>
            {file.status === "done" && !isEditing && (
              <>
                <button onClick={handleExport} className="btn btn-glass"
                  style={{ fontSize: 11, borderRadius: 9 }}>
                  <Download size={11} /> Excel
                </button>
                <button
                  onClick={() => { setEditText(file.result ?? ""); setIsEditing(true); }}
                  className="btn btn-primary"
                  style={{ fontSize: 11, borderRadius: 9 }}>
                  <Pencil size={11} /> 编辑
                </button>
              </>
            )}
            {isEditing && (
              <>
                <button onClick={handleSave} disabled={saving}
                  className="btn btn-success" style={{ fontSize: 11, borderRadius: 9 }}>
                  <Check size={11} /> {saving ? "保存中…" : "保存"}
                </button>
                <button onClick={() => setIsEditing(false)}
                  className="btn btn-glass" style={{ fontSize: 11, borderRadius: 9 }}>
                  取消
                </button>
              </>
            )}
            <button onClick={onClose} className="btn btn-glass"
              style={{ padding: 0, borderRadius: 9, width: 30, height: 30 }}>
              <X size={15} />
            </button>
          </div>
        </div>

        {/* 主内容区 */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

          {/* 左侧：深色媒体预览 */}
          <div style={{
            width: isWide ? 380 : 200, flexShrink: 0,
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", padding: 20, gap: 14,
            borderRight: "1px solid rgba(255,255,255,0.04)",
            background: "#0D1117",
          }}>
            {/* 图片 */}
            {file.fileType === "image" && file.previewUrl && (
              <img src={file.previewUrl} alt={file.name}
                style={{ maxWidth: "100%", maxHeight: 340, objectFit: "contain",
                  borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }} />
            )}

            {/* 视频 */}
            {file.fileType === "video" && file.previewUrl && (
              <video src={file.previewUrl} controls
                style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 12,
                  background: "#000", boxShadow: "0 6px 24px rgba(0,0,0,0.5)", outline: "none" }} />
            )}

            {/* 音频 */}
            {file.fileType === "audio" && (
              <div style={{ width: "100%", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 16 }}>
                {/* 波形可视化 */}
                <div style={{
                  width: "100%", height: 80, borderRadius: 14,
                  background: "linear-gradient(160deg, rgba(26,86,255,0.15) 0%, rgba(99,102,241,0.08) 100%)",
                  border: "1px solid rgba(26,86,255,0.18)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 2, padding: "0 12px",
                }}>
                  {Array.from({length:24}, (_,i) => (
                    <div key={i} style={{
                      width: 3, borderRadius: 2, flexShrink: 0,
                      height: `${22 + Math.abs(Math.sin(i * 0.8)) * 55}%`,
                      background: `linear-gradient(180deg, rgba(99,102,241,${0.35 + Math.abs(Math.sin(i * 0.5)) * 0.4}), rgba(26,86,255,${0.5 + Math.abs(Math.sin(i * 0.5)) * 0.4}))`,
                    }}/>
                  ))}
                </div>
                {file.previewUrl && (
                  <audio controls src={file.previewUrl}
                    style={{ width: "100%", borderRadius: 8, colorScheme: "dark" }} />
                )}
              </div>
            )}

            {/* 文本 / 其他 */}
            {file.fileType !== "image" && file.fileType !== "video" && file.fileType !== "audio" && (
              <div style={{ display: "flex", flexDirection: "column",
                alignItems: "center", gap: 10 }}>
                <div style={{ width: 60, height: 60, borderRadius: 16, display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 32,
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {FILE_TYPE_ICON[file.fileType]}
                </div>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                  {FILE_TYPE_LABEL[file.fileType]}
                </span>
              </div>
            )}

            {/* 转录文本 */}
            {file.transcript && (
              <div style={{ width: "100%", borderRadius: 12, padding: "10px 12px",
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
                maxHeight: 120, overflowY: "auto" }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.30)", marginBottom: 5,
                  letterSpacing: "0.05em" }}>
                  {file.fileType === "audio" ? "🎙 TRANSCRIPT" : "🎬 TRANSCRIPT"}
                </p>
                <p style={{ fontSize: 11, lineHeight: 1.7, color: "rgba(255,255,255,0.55)",
                  whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {file.transcript}
                </p>
              </div>
            )}
          </div>

          {/* 右侧：打标结果（亮色） */}
          <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px",
            display: "flex", flexDirection: "column", gap: 14 }}>

            {file.status === "done" && (
              <>
                {isEditing ? (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600,
                      color: "var(--text-tertiary)", marginBottom: 8 }}>✏️ 编辑打标结果</p>
                    <textarea
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      className="input textarea"
                      style={{ minHeight: 320, fontSize: 13, lineHeight: 1.7,
                        borderRadius: 12, width: "100%" }}
                    />
                    <p style={{ fontSize: 11, color: "var(--text-quaternary)", marginTop: 6 }}>
                      修改后点击「保存」更新结果，可视化图表将同步刷新。
                    </p>
                  </div>
                ) : (
                  <LabelResultView result={file.result} compact={false} />
                )}
              </>
            )}

            {file.truncated && (
              <div style={{ borderRadius: 12, padding: "10px 12px", display: "flex",
                alignItems: "flex-start", gap: 8, fontSize: 12,
                background: "var(--orange-subtle)", color: "var(--orange)" }}>
                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>原文 <strong>{file.originalChars?.toLocaleString()}</strong> 字符，仅分析前 6,000 字符</span>
              </div>
            )}

            {(file.status === "uploading" || file.status === "processing") && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", height: 200, gap: 14 }}>
                <div className="anim-breathe"
                  style={{ width: 48, height: 48, borderRadius: "50%",
                    background: "var(--accent-subtle)", border: "1.5px solid var(--accent-border)",
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div className="anim-spin"
                    style={{ width: 22, height: 22, borderRadius: "50%",
                      border: "2px solid var(--accent)", borderTopColor: "transparent" }} />
                </div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {file.status === "uploading" ? `上传中 ${file.uploadProgress ?? 0}%` :
                    (file.fileType === "audio" || file.fileType === "video")
                      ? "后台处理中，关闭弹窗可继续操作" : "AI 分析中，请稍候…"}
                </p>
              </div>
            )}

            {file.status === "error" && (
              <div style={{ borderRadius: 14, padding: 16,
                background: "var(--red-subtle)", border: "0.5px solid rgba(255,59,48,0.2)",
                color: "var(--red)" }}>
                <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>处理失败</p>
                <p style={{ fontSize: 12 }}>{file.errorMsg}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
