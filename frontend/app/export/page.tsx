"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  ArrowLeft, Download, Search, Filter, Trash2, RefreshCw,
  Database, AlertTriangle, CheckCircle2, FileText, Image as ImageIcon,
  Music, Video, Clock, ChevronDown, X, Info, Loader2
} from "lucide-react";
import { API_BASE, APP_TOKEN, apiFetch } from "../../lib/supabase";

// ── 类型 ─────────────────────────────────────────────────────
interface ResultItem {
  id:           string;
  createdAt:    string;
  fileName:     string;
  fileType:     "image" | "audio" | "video" | "text";
  fileUrl:      string;
  result:       string;
  transcript:   string;
  inputTokens:  number;
  outputTokens: number;
}

interface DbStats {
  labelResultsCount:  number;
  filesMetadataCount: number;
  tokenUsageCount:    number;
  totalRows:          number;
  freeRowLimit:       number;
  usagePercent:       number;
  suggestedDeleteDays: number;
  warning:            boolean;
  error?:             string;
}

const FILE_TYPE_ICON: Record<string, React.ReactNode> = {
  image: <ImageIcon size={12} />,
  audio: <Music size={12} />,
  video: <Video size={12} />,
  text:  <FileText size={12} />,
};
const FILE_TYPE_LABEL: Record<string, string> = {
  image: "图片", audio: "音频", video: "视频", text: "文本",
};
const FILE_TYPE_COLOR: Record<string, string> = {
  image: "#0A84FF", audio: "#FF9F0A", video: "#30D158", text: "#BF5AF2",
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return iso; }
}

/** 从打标结果文本中提取 Top3 核心标签 */
function extractTop3(result: string): string {
  try {
    const lines = result.split("\n");
    const top3Idx = lines.findIndex(l => /top3|核心标签|最相关/i.test(l));
    if (top3Idx < 0) return "";
    const tags: string[] = [];
    for (let i = top3Idx + 1; i < lines.length && tags.length < 3; i++) {
      const m = lines[i].match(/^[-*•·]\s*(.+)/);
      if (m) tags.push(m[1].replace(/（最相关）|（.*?）/g, "").replace(/^标签\d+\s*[:：]?\s*/, "").trim());
      else if (lines[i].match(/^#{1,3}\s/)) break;
    }
    return tags.join(" / ");
  } catch { return ""; }
}

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const min  = Math.floor(diff / 60000);
    const hr   = Math.floor(diff / 3600000);
    const day  = Math.floor(diff / 86400000);
    if (day >= 1)  return `${day}天前`;
    if (hr >= 1)   return `${hr}小时前`;
    if (min >= 1)  return `${min}分钟前`;
    return "刚刚";
  } catch { return ""; }
}

export default function ExportPage() {
  const router = useRouter();

  const [items, setItems]           = useState<ResultItem[]>([]);
  const [dbStats, setDbStats]       = useState<DbStats | null>(null);
  const [loading, setLoading]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage]             = useState(1);
  const [hasMore, setHasMore]       = useState(true);
  const PAGE_SIZE = 50;

  // ── 过滤 ──────────────────────────────────────────────────
  const [keyword, setKeyword]       = useState("");
  const [filterType, setFilterType] = useState<string>("");

  // ── 选中行（导出勾选）─────────────────────────────────────
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [expanded, setExpanded]     = useState<string | null>(null);

  // ── 清理确认弹窗 ──────────────────────────────────────────
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupDays, setCleanupDays] = useState(90);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ deletedResults: number; deletedFiles: number } | null>(null);

  // ── 加载历史结果 ──────────────────────────────────────────
  const loadResults = useCallback(async (p: number, append = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        page_size: String(PAGE_SIZE),
        ...(filterType ? { file_type: filterType } : {}),
        ...(keyword    ? { keyword }              : {}),
      });
      const res  = await apiFetch(`${API_BASE}/export/results?${params}`);
      const data = await res.json();
      const newItems: ResultItem[] = data.items || [];
      setItems(prev => append ? [...prev, ...newItems] : newItems);
      setHasMore(newItems.length === PAGE_SIZE);
      setPage(p);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filterType, keyword]);

  // ── 加载 DB 统计 ──────────────────────────────────────────
  const loadDbStats = useCallback(async () => {
    try {
      const res  = await apiFetch(`${API_BASE}/export/db-stats`);
      const data = await res.json();
      setDbStats(data);
    } catch { /* ignore */ }
  }, []);

  // 初始加载
  useEffect(() => { loadResults(1); loadDbStats(); }, [loadResults, loadDbStats]);

  // 过滤变化时重新加载
  useEffect(() => { loadResults(1); }, [filterType]); // eslint-disable-line

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); loadResults(1); };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadResults(1), loadDbStats()]);
    setRefreshing(false);
  };

  const loadMore = () => { if (!loading && hasMore) loadResults(page + 1, true); };

  // ── 全选/取消 ─────────────────────────────────────────────
  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll   = () => setSelected(allSelected ? new Set() : new Set(items.map(i => i.id)));
  const toggleOne   = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  // ── 导出选中 ─────────────────────────────────────────────
  const handleExport = (exportItems: ResultItem[]) => {
    const rows = exportItems.map(item => ({
      "创建时间":     formatDate(item.createdAt),
      "文件名":       item.fileName,
      "类型":         FILE_TYPE_LABEL[item.fileType] || item.fileType,
      "Top3核心标签": extractTop3(item.result),
      "打标结果（完整）": item.result,
      "【校验_打标结果】": "",
      "转录文本":     item.transcript,
      "【校验_转录文本】": "",
      "Input Tokens": item.inputTokens,
      "Output Tokens": item.outputTokens,
      "合计 Tokens":  item.inputTokens + item.outputTokens,
      "标注备注":     "结果严格按用户设定的提示词格式输出，Top3标签和质量评分详见「打标结果（完整）」列",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 18 }, { wch: 30 }, { wch: 6 },
      { wch: 40 }, { wch: 80 }, { wch: 30 },
      { wch: 60 }, { wch: 30 },
      { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 50 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "打标结果");
    const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
    XLSX.writeFile(wb, `ai_labels_${ts}.xlsx`);
  };

  // ── 清理操作 ──────────────────────────────────────────────
  const handleCleanup = async () => {
    setCleanupLoading(true);
    try {
      const res  = await apiFetch(
        `${API_BASE}/export/cleanup?keep_days=${cleanupDays}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      setCleanupResult({ deletedResults: data.deletedResults, deletedFiles: data.deletedFiles });
      await Promise.all([loadResults(1), loadDbStats()]);
    } catch { /* ignore */ }
    finally { setCleanupLoading(false); }
  };

  const selectedItems = items.filter(i => selected.has(i.id));
  const displayItems  = filterType || keyword
    ? items.filter(i =>
        (!filterType || i.fileType === filterType) &&
        (!keyword    || i.fileName.toLowerCase().includes(keyword.toLowerCase()))
      )
    : items;

  // ── 容量进度条颜色 ─────────────────────────────────────────
  const usagePct   = dbStats?.usagePercent ?? 0;
  const barColor   = usagePct > 80 ? "#FF3B30" : usagePct > 50 ? "#FF9F0A" : "#34C759";

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: "var(--bg)", overflow: "hidden",
    }}>

      {/* 顶栏 */}
      <header className="glass-panel" style={{
        position: "sticky", top: 0, zIndex: 40,
        display: "flex", alignItems: "center",
        gap: 12, padding: "0 20px", height: 52,
        borderBottom: "0.5px solid var(--separator-heavy)",
        flexShrink: 0,
      }}>
        <button onClick={() => router.back()} className="btn btn-glass"
          style={{ padding: "6px 10px", borderRadius: 9, gap: 5 }}>
          <ArrowLeft size={14} />
          <span style={{ fontSize: 12 }}>返回</span>
        </button>

        <div style={{ width: 0.5, height: 20, background: "var(--separator-heavy)" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: "linear-gradient(145deg, #007AFF, #5AC8FA)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
          }}>📤</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>历史导出中心</div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>按最新时间排列 · 支持筛选导出</div>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* DB 用量指示器 */}
        {dbStats && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
            borderRadius: 10, background: dbStats.warning ? "rgba(255,59,48,0.08)" : "var(--bg-secondary)",
            border: `0.5px solid ${dbStats.warning ? "rgba(255,59,48,0.3)" : "var(--separator)"}`,
          }}>
            <Database size={12} style={{ color: dbStats.warning ? "var(--red)" : "var(--text-tertiary)" }} />
            <div>
              <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 2 }}>
                数据库容量 {usagePct.toFixed(1)}%
              </div>
              <div style={{ width: 80, height: 4, borderRadius: 2, background: "var(--bg-tertiary)", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(usagePct, 100)}%`, height: "100%", background: barColor, borderRadius: 2, transition: "width 500ms" }} />
              </div>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
              推荐保留 <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{dbStats.suggestedDeleteDays}</span> 天
            </div>
            {dbStats.warning && (
              <AlertTriangle size={12} style={{ color: "var(--red)" }} />
            )}
          </div>
        )}

        {/* 清理按钮 */}
        <button onClick={() => { setCleanupOpen(true); setCleanupResult(null); }}
          className="btn btn-glass"
          style={{ gap: 5, borderRadius: 10, fontSize: 12, color: "var(--red)" }}>
          <Trash2 size={12} />
          清理历史
        </button>

        {/* 刷新 */}
        <button onClick={handleRefresh} disabled={refreshing} className="btn btn-glass"
          style={{ padding: 7, borderRadius: 9 }}>
          <RefreshCw size={13} style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} />
        </button>
      </header>

      {/* 工具栏 */}
      <div style={{
        padding: "10px 20px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
        borderBottom: "0.5px solid var(--separator)", background: "var(--bg-secondary)",
      }}>
        {/* 搜索 */}
        <form onSubmit={handleSearch} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, maxWidth: 300 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="搜索文件名…"
              className="input"
              style={{ paddingLeft: 30, height: 32, fontSize: 12, borderRadius: 9 }}
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ height: 32, padding: "0 12px", fontSize: 12 }}>搜索</button>
        </form>

        {/* 类型过滤 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {["", "image", "audio", "video", "text"].map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              style={{
                padding: "4px 10px", borderRadius: 8, fontSize: 11, cursor: "pointer",
                border: "none", fontWeight: 500,
                background: filterType === t ? (t ? FILE_TYPE_COLOR[t] : "var(--accent)") : "var(--bg-tertiary)",
                color: filterType === t ? "#fff" : "var(--text-secondary)",
                transition: "all 150ms",
              }}>
              {t === "" ? "全部" : FILE_TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* 选中计数 + 导出 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {selected.size > 0 && (
            <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>已选 {selected.size} 条</span>
          )}
          <button
            onClick={() => handleExport(selected.size > 0 ? selectedItems : displayItems)}
            className="btn btn-primary"
            style={{ gap: 6, borderRadius: 10, fontSize: 12 }}
            disabled={displayItems.length === 0}>
            <Download size={13} />
            {selected.size > 0 ? `导出选中 (${selected.size})` : `导出全部 (${displayItems.length})`}
          </button>
        </div>
      </div>

      {/* 表格区域 */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 20px 20px" }}>

        {/* 统计卡片 */}
        {dbStats && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12, padding: "16px 0 12px",
          }}>
            {[
              { label: "打标记录总数",  value: dbStats.labelResultsCount,  icon: "📋", color: "#0A84FF" },
              { label: "文件记录总数",  value: dbStats.filesMetadataCount, icon: "📁", color: "#FF9F0A" },
              { label: "Token 统计记录", value: dbStats.tokenUsageCount,    icon: "⚡", color: "#30D158" },
              { label: "数据库行总数",  value: dbStats.totalRows,           icon: "🗄️", color: dbStats.warning ? "#FF3B30" : "#BF5AF2" },
            ].map(({ label, value, icon, color }) => (
              <div key={label} style={{
                borderRadius: 14, padding: "14px 16px",
                background: "var(--bg-white)",
                border: "0.5px solid var(--separator)",
                boxShadow: "var(--shadow-card)",
              }}>
                <div style={{ fontSize: 18, marginBottom: 6 }}>{icon}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color, marginBottom: 2 }}>
                  {value.toLocaleString()}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* 列表 */}
        {loading && items.length === 0 ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60, color: "var(--text-tertiary)" }}>
            <Loader2 size={24} className="anim-spin" />
          </div>
        ) : displayItems.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-tertiary)" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
            <p style={{ fontSize: 14 }}>暂无打标记录</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>完成打标任务后，历史记录会在这里显示</p>
          </div>
        ) : (
          <>
            {/* 表头 */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "36px 1fr 60px 80px 1fr 120px",
              gap: 12, padding: "8px 16px",
              background: "var(--bg-secondary)",
              borderRadius: "12px 12px 0 0",
              border: "0.5px solid var(--separator)",
              fontSize: 11, color: "var(--text-tertiary)", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.04em",
            }}>
              <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  style={{ width: 14, height: 14, cursor: "pointer" }} />
              </label>
              <span>文件名</span>
              <span>类型</span>
              <span>时间</span>
              <span>打标结果（预览）</span>
              <span>Tokens (in/out)</span>
            </div>

            {/* 行 */}
            <div style={{ border: "0.5px solid var(--separator)", borderTop: "none", borderRadius: "0 0 12px 12px", overflow: "hidden" }}>
              {displayItems.map((item, idx) => {
                const isExpanded = expanded === item.id;
                const isSelected = selected.has(item.id);
                return (
                  <div key={item.id}>
                    {/* 主行 */}
                    <div
                      onClick={() => setExpanded(isExpanded ? null : item.id)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "36px 1fr 60px 80px 1fr 120px",
                        gap: 12, padding: "12px 16px",
                        cursor: "pointer",
                        background: isSelected ? "var(--accent-subtle)" :
                          isExpanded ? "var(--bg-secondary)" :
                          idx % 2 === 1 ? "var(--bg-secondary)" : "var(--bg-white)",
                        borderTop: idx > 0 ? "0.5px solid var(--separator)" : "none",
                        transition: "background 100ms",
                      }}>
                      {/* 勾选 */}
                      <label onClick={e => e.stopPropagation()}
                        style={{ display: "flex", alignItems: "center" }}>
                        <input type="checkbox" checked={isSelected}
                          onChange={() => toggleOne(item.id)}
                          style={{ width: 14, height: 14, cursor: "pointer" }} />
                      </label>

                      {/* 文件名 */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        <span style={{ fontSize: 11 }}>
                          {item.fileName}
                        </span>
                      </div>

                      {/* 类型 */}
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ color: FILE_TYPE_COLOR[item.fileType] }}>
                          {FILE_TYPE_ICON[item.fileType]}
                        </span>
                        <span style={{ fontSize: 10, color: FILE_TYPE_COLOR[item.fileType] }}>
                          {FILE_TYPE_LABEL[item.fileType]}
                        </span>
                      </div>

                      {/* 时间 */}
                      <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
                        <div>{timeAgo(item.createdAt)}</div>
                        <div style={{ marginTop: 2 }}>{formatDate(item.createdAt).slice(11)}</div>
                      </div>

                      {/* 结果预览 */}
                      <div style={{
                        fontSize: 11, color: "var(--text-secondary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        lineHeight: 1.4,
                      }}>
                        {item.result.slice(0, 120) || "—"}
                      </div>

                      {/* Tokens */}
                      <div style={{ fontSize: 10, color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: "#0A84FF" }}>{item.inputTokens}</span>
                        <span>/</span>
                        <span style={{ color: "#FF9F0A" }}>{item.outputTokens}</span>
                        <ChevronDown size={10} style={{
                          marginLeft: "auto", transform: isExpanded ? "rotate(180deg)" : "none",
                          transition: "transform 200ms", flexShrink: 0,
                          color: "var(--text-quaternary)",
                        }} />
                      </div>
                    </div>

                    {/* 展开详情 */}
                    {isExpanded && (
                      <div style={{
                        padding: "16px 16px 16px 52px",
                        background: "var(--bg-secondary)",
                        borderTop: "0.5px solid var(--separator)",
                      }}>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                          <div style={{ flex: 2, minWidth: 280 }}>
                            <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)",
                              marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                              打标结果
                            </p>
                            <pre style={{
                              fontSize: 11, color: "var(--text-primary)",
                              lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word",
                              background: "var(--bg-white)", borderRadius: 10,
                              padding: "12px 14px",
                              border: "0.5px solid var(--separator)",
                              maxHeight: 300, overflowY: "auto",
                            }}>{item.result}</pre>
                          </div>
                          {item.transcript && (
                            <div style={{ flex: 1, minWidth: 200 }}>
                              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)",
                                marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                转录文本
                              </p>
                              <pre style={{
                                fontSize: 11, color: "var(--text-secondary)",
                                lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word",
                                background: "var(--bg-white)", borderRadius: 10,
                                padding: "12px 14px",
                                border: "0.5px solid var(--separator)",
                                maxHeight: 300, overflowY: "auto",
                              }}>{item.transcript}</pre>
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                          <button onClick={() => handleExport([item])}
                            className="btn btn-glass"
                            style={{ fontSize: 11, gap: 5, borderRadius: 8 }}>
                            <Download size={11} /> 单条导出
                          </button>
                          <span style={{ fontSize: 10, color: "var(--text-quaternary)", alignSelf: "center" }}>
                            完整时间：{formatDate(item.createdAt)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 加载更多 */}
            {hasMore && (
              <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
                <button onClick={loadMore} disabled={loading} className="btn btn-glass"
                  style={{ fontSize: 12, gap: 6 }}>
                  {loading ? <Loader2 size={12} className="anim-spin" /> : null}
                  {loading ? "加载中…" : "加载更多"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 清理弹窗 */}
      {cleanupOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.3)", backdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={e => { if (e.target === e.currentTarget && !cleanupLoading) setCleanupOpen(false); }}>
          <div style={{
            width: 420, borderRadius: 20, background: "var(--bg-white)",
            boxShadow: "var(--shadow-xl)", padding: 24,
            border: "0.5px solid var(--separator-heavy)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,59,48,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Trash2 size={16} style={{ color: "var(--red)" }} />
              </div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>清理历史记录</h3>
                <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 1 }}>
                  删除指定日期前的打标记录，释放数据库空间
                </p>
              </div>
              <button onClick={() => !cleanupLoading && setCleanupOpen(false)}
                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <X size={16} style={{ color: "var(--text-tertiary)" }} />
              </button>
            </div>

            {/* DB 用量展示 */}
            {dbStats && (
              <div style={{
                padding: "12px 14px", borderRadius: 12, marginBottom: 16,
                background: dbStats.warning ? "rgba(255,59,48,0.06)" : "var(--bg-secondary)",
                border: `0.5px solid ${dbStats.warning ? "rgba(255,59,48,0.2)" : "var(--separator)"}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>当前数据库使用量</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: barColor }}>
                    {usagePct.toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "var(--bg-tertiary)", overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ width: `${Math.min(usagePct, 100)}%`, height: "100%", background: barColor, borderRadius: 3 }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-tertiary)" }}>
                  <span>打标记录：{dbStats.labelResultsCount.toLocaleString()} 条</span>
                  <span>总行数：{dbStats.totalRows.toLocaleString()} / {dbStats.freeRowLimit.toLocaleString()}</span>
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 5 }}>
                  <Info size={10} />
                  推荐保留 <strong>{dbStats.suggestedDeleteDays}</strong> 天内的记录
                </div>
              </div>
            )}

            {/* 选择保留天数 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 500,
                color: "var(--text-secondary)", marginBottom: 8 }}>
                保留最近几天的数据
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[30, 60, 90, 180].map(d => (
                  <button key={d} onClick={() => setCleanupDays(d)}
                    style={{
                      padding: "6px 14px", borderRadius: 9, fontSize: 12, cursor: "pointer", border: "none",
                      background: cleanupDays === d ? "var(--accent)" : "var(--bg-secondary)",
                      color: cleanupDays === d ? "#fff" : "var(--text-secondary)",
                      fontWeight: cleanupDays === d ? 600 : 400, transition: "all 150ms",
                    }}>
                    {d} 天
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: "var(--red)", marginTop: 8 }}>
                ⚠️ 将删除 <strong>{cleanupDays}</strong> 天前的所有打标记录，此操作不可撤销
              </p>
            </div>

            {/* 清理结果 */}
            {cleanupResult && (
              <div style={{ padding: "10px 14px", borderRadius: 10, marginBottom: 12,
                background: "rgba(52,199,89,0.08)", border: "0.5px solid rgba(52,199,89,0.3)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <CheckCircle2 size={14} style={{ color: "var(--green)" }} />
                  <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 500 }}>
                    清理完成：删除打标记录 {cleanupResult.deletedResults} 条，文件记录 {cleanupResult.deletedFiles} 条
                  </span>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleCleanup}
                disabled={cleanupLoading}
                className="btn"
                style={{
                  flex: 1, height: 40, borderRadius: 12, fontSize: 13,
                  justifyContent: "center", gap: 6,
                  background: "var(--red)", color: "#fff", border: "none", cursor: "pointer",
                  opacity: cleanupLoading ? 0.7 : 1,
                }}>
                {cleanupLoading ? <Loader2 size={14} className="anim-spin" /> : <Trash2 size={14} />}
                {cleanupLoading ? "清理中…" : `删除 ${cleanupDays} 天前的记录`}
              </button>
              <button onClick={() => !cleanupLoading && setCleanupOpen(false)}
                className="btn btn-glass"
                style={{ height: 40, padding: "0 16px", borderRadius: 12 }}>取消</button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
