"use client";

import { useState, useEffect, useCallback } from "react";
import { API_BASE, apiFetch } from "../../lib/supabase";
import { TokenDay, TokenByModel } from "../../lib/types";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import { TrendingUp, RefreshCw, BarChart2, PieChart as PieIcon, Layers } from "lucide-react";

const MODEL_COLORS = ["#1A56FF", "#6366F1", "#8B5CF6", "#06B6D4", "#22C55E", "#F59E0B"];

const FILETYPE_META: Record<string, { label: string; icon: string; color: string }> = {
  image: { label: "图片", icon: "🖼️", color: "#1A56FF" },
  audio: { label: "音频", icon: "🎵", color: "#6366F1" },
  video: { label: "视频", icon: "🎬", color: "#8B5CF6" },
  text:  { label: "文本", icon: "📄", color: "#06B6D4" },
};

interface TokenByFileType {
  file_type: string;
  input: number;
  output: number;
  total: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      borderRadius: 12, padding: "10px 14px", fontSize: 12,
      background: "var(--bg-white)", border: "0.5px solid var(--separator-heavy)",
      boxShadow: "var(--shadow-md)",
    }}>
      <p style={{ fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>{label}</p>
      {payload.map((p: { name: string; value: number; fill: string }) => (
        <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: p.fill }} />
          <span style={{ color: "var(--text-secondary)" }}>{p.name}</span>
          <span style={{ fontWeight: 700, color: p.fill, marginLeft: "auto", paddingLeft: 12 }}>
            {p.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function fmt(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}

export default function TokenChart() {
  const [data, setData]           = useState<TokenDay[]>([]);
  const [byModel, setByModel]     = useState<TokenByModel[]>([]);
  const [byFileType, setByFileType] = useState<TokenByFileType[]>([]);
  const [total, setTotal]         = useState({ total_input: 0, total_output: 0, total: 0 });
  const [loading, setLoading]     = useState(false);
  const [view, setView]           = useState<"trend" | "model" | "filetype">("trend");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2, r3, r4] = await Promise.all([
        apiFetch(`${API_BASE}/token-usage?days=7`),
        apiFetch(`${API_BASE}/token-usage/total`),
        apiFetch(`${API_BASE}/token-usage/by-model?days=30`),
        apiFetch(`${API_BASE}/token-usage/by-filetype?days=30`),
      ]);
      const d1 = await r1.json(); const d2 = await r2.json();
      const d3 = await r3.json(); const d4 = await r4.json();
      if (Array.isArray(d1)) setData(d1);
      if (d2) setTotal(d2);
      if (Array.isArray(d3)) setByModel(d3);
      if (Array.isArray(d4)) setByFileType(d4);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const formatted = data.map(d => ({ ...d, day: d.day.slice(5), total: d.total_input + d.total_output }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 头部 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <TrendingUp size={14} style={{ color: "var(--accent)" }} />
          <span style={{ fontSize: 14, fontWeight: 700 }}>Token 消耗统计</span>
        </div>
        <button onClick={fetchData} disabled={loading} className="btn btn-glass"
          style={{ padding: 5, width: 28, height: 28, borderRadius: 8 }}>
          <RefreshCw size={12} className={loading ? "anim-spin" : ""} />
        </button>
      </div>

      {/* 汇总数字 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {[
          { label: "输入 Token", val: total.total_input,  color: "var(--green)" },
          { label: "输出 Token", val: total.total_output, color: "var(--orange)" },
          { label: "合计",       val: total.total,        color: "var(--accent)" },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ borderRadius: 14, padding: "12px 10px", textAlign: "center",
            background: "var(--bg-secondary)", border: "0.5px solid var(--separator)" }}>
            <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>{label}</p>
            <p style={{ fontSize: 16, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>
              {fmt(val)}
            </p>
          </div>
        ))}
      </div>

      {/* 视图切换 */}
      <div style={{ display: "flex", gap: 4, background: "var(--bg-tertiary)", borderRadius: 10, padding: 3 }}>
        {([
          { id: "trend"    as const, icon: <BarChart2 size={11} />, label: "7天趋势" },
          { id: "filetype" as const, icon: <Layers    size={11} />, label: "模态分布" },
          { id: "model"    as const, icon: <PieIcon   size={11} />, label: "模型分布" },
        ] as const).map(({ id, icon, label }) => (
          <button key={id} onClick={() => setView(id)}
            style={{
              flex: 1, height: 30, fontSize: 11, borderRadius: 8, border: "none",
              background: view === id ? "var(--bg-white)" : "transparent",
              color: view === id ? "var(--accent)" : "var(--text-tertiary)",
              fontWeight: view === id ? 700 : 400,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              boxShadow: view === id ? "var(--shadow-sm)" : "none",
              transition: "all 200ms",
              cursor: "pointer",
            }}>
            {icon} {label}
          </button>
        ))}
      </div>

      {/* ── 7天趋势 ── */}
      {view === "trend" && (
        formatted.length > 0 ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={formatted} barGap={2} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="2 4" stroke="var(--separator)" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} width={32} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="total_input"  name="输入" fill="var(--accent)" radius={[3,3,0,0]} />
              <Bar dataKey="total_output" name="输出" fill="#6366F1" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState text="打标后自动记录每日消耗" />
        )
      )}

      {/* ── 模态分布 ── */}
      {view === "filetype" && (
        byFileType.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {byFileType.map(ft => {
              const meta = FILETYPE_META[ft.file_type] || { label: ft.file_type, icon: "📁", color: "var(--accent)" };
              const maxTotal = Math.max(...byFileType.map(x => x.total), 1);
              const pct = (ft.total / maxTotal) * 100;
              return (
                <div key={ft.file_type} style={{
                  borderRadius: 12, padding: "12px 14px",
                  background: "var(--bg-secondary)", border: "0.5px solid var(--separator)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 18 }}>{meta.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{meta.label}</span>
                    <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800,
                      color: meta.color, fontVariantNumeric: "tabular-nums" }}>
                      {fmt(ft.total)}
                    </span>
                  </div>
                  {/* 进度条 */}
                  <div style={{ height: 5, borderRadius: 3, background: "var(--bg-tertiary)", marginBottom: 6 }}>
                    <div style={{ height: "100%", borderRadius: 3, background: meta.color,
                      width: `${pct}%`, transition: "width 600ms var(--ease-smooth)" }} />
                  </div>
                  {/* 输入/输出明细 */}
                  <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
                    <span style={{ color: "var(--green)" }}>输入 {fmt(ft.input)}</span>
                    <span style={{ color: "var(--orange)" }}>输出 {fmt(ft.output)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState text="打标后按模态自动分类统计" />
        )
      )}

      {/* ── 模型分布 ── */}
      {view === "model" && (
        byModel.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={byModel} dataKey="total" nameKey="model"
                  cx="50%" cy="50%" innerRadius={32} outerRadius={56} paddingAngle={3}>
                  {byModel.map((_, i) => (
                    <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {byModel.map((m, i) => (
                <div key={m.model} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11,
                  padding: "6px 10px", borderRadius: 9, background: "var(--bg-secondary)" }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                    background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap", color: "var(--text-secondary)" }}>{m.model}</span>
                  <span style={{ color: "var(--accent)", fontWeight: 600 }}>{fmt(m.input)}</span>
                  <span style={{ color: "var(--text-tertiary)" }}>+</span>
                  <span style={{ color: "#6366F1", fontWeight: 600 }}>{fmt(m.output)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <EmptyState text="暂无数据" />
        )
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ height: 110, borderRadius: 12, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 6,
      background: "var(--bg-secondary)", border: "0.5px solid var(--separator)" }}>
      <BarChart2 size={20} style={{ color: "var(--text-quaternary)" }} strokeWidth={1.5} />
      <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{text}</p>
    </div>
  );
}
