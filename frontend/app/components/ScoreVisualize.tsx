"use client";

import { useMemo } from "react";
import { parseScores, ParsedScores, ScoreItem } from "../../lib/scoreParser";

/* ═══ 分数颜色映射 ═══ */
function scoreColor(s: number): string {
  if (s >= 80) return "var(--green)";
  if (s >= 60) return "var(--accent)";
  if (s >= 40) return "var(--orange)";
  return "var(--red)";
}

function scoreBg(s: number): string {
  if (s >= 80) return "var(--green-subtle)";
  if (s >= 60) return "var(--accent-subtle)";
  if (s >= 40) return "var(--orange-subtle)";
  return "var(--red-subtle)";
}

function scoreLabel(s: number): string {
  if (s >= 90) return "优秀";
  if (s >= 80) return "良好";
  if (s >= 60) return "中等";
  if (s >= 40) return "一般";
  return "较差";
}

/* ═══ 环形进度条 (SVG) ═══ */
function RingProgress({ score, size = 72, strokeWidth = 5, label }: {
  score: number; size?: number; strokeWidth?: number; label?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);
  const color = scoreColor(score);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {/* 背景圈 */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--separator)" strokeWidth={strokeWidth} />
        {/* 分数弧 */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 800ms cubic-bezier(0.34,1.56,0.64,1)" }} />
      </svg>
      {/* 中心数字 */}
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: size * 0.3, fontWeight: 800, color, lineHeight: 1,
          fontVariantNumeric: "tabular-nums" }}>
          {score}
        </span>
        {label && (
          <span style={{ fontSize: Math.max(9, size * 0.13), color: "var(--text-tertiary)",
            marginTop: 1, fontWeight: 500 }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══ 横条进度条 ═══ */
function BarProgress({ item }: { item: ScoreItem }) {
  const color = scoreColor(item.score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 52, fontSize: 11, fontWeight: 500, color: "var(--text-secondary)",
        textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap" }}>
        {item.label}
      </span>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--bg-tertiary)",
        overflow: "hidden", position: "relative" }}>
        <div style={{
          height: "100%", borderRadius: 3, background: color,
          width: `${item.score}%`,
          transition: "width 700ms cubic-bezier(0.34,1.56,0.64,1)",
        }} />
      </div>
      <span style={{ width: 38, fontSize: 11, fontWeight: 700, color,
        textAlign: "right", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
        {item.displayText}
      </span>
    </div>
  );
}

/* ═══ 迷你分数角标 (用在列表项) ═══ */
export function ScoreBadge({ result, style }: { result?: string; style?: React.CSSProperties }) {
  const parsed = useMemo(() => parseScores(result), [result]);
  if (!parsed.hasScores || !parsed.overall) return null;

  const s = parsed.overall.score;
  const color = scoreColor(s);
  const bg    = scoreBg(s);

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: 26, height: 18, borderRadius: 9,
      padding: "0 5px", fontSize: 10, fontWeight: 700,
      color, background: bg,
      fontVariantNumeric: "tabular-nums",
      ...style,
    }}>
      {s}
    </span>
  );
}

/* ═══ 完整分数可视化面板 ═══ */
interface Props {
  result?: string;
  compact?: boolean;  // true = 紧凑模式 (右侧面板用)
}

export default function ScoreVisualize({ result, compact = false }: Props) {
  const parsed: ParsedScores = useMemo(() => parseScores(result), [result]);

  if (!parsed.hasScores) return null;

  const { overall, dimensions } = parsed;

  if (compact) {
    return (
      <div style={{
        borderRadius: 12, padding: "10px 12px",
        background: "var(--bg-secondary)", border: "0.5px solid var(--separator)",
      }}
        className="anim-slide-up">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: dimensions.length > 0 ? 8 : 0 }}>
          {overall && <RingProgress score={overall.score} size={48} strokeWidth={4} />}
          {overall && (
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: scoreColor(overall.score) }}>
                {scoreLabel(overall.score)}
              </p>
              <p style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 1 }}>
                {overall.displayText}
              </p>
            </div>
          )}
        </div>
        {dimensions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {dimensions.slice(0, 5).map(d => (
              <BarProgress key={d.label} item={d} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // 完整模式 (弹窗用)
  return (
    <div style={{
      borderRadius: 16, padding: 16,
      background: "var(--bg-secondary)", border: "0.5px solid var(--separator)",
    }}
      className="anim-scale">

      {/* 标题 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
        <span style={{ fontSize: 14 }}>📊</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-tertiary)" }}>评分可视化</span>
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>

        {/* 左侧 — 环形总分 */}
        {overall && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <RingProgress score={overall.score} size={88} strokeWidth={6} label={overall.label} />
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: scoreColor(overall.score),
              padding: "2px 10px", borderRadius: 20,
              background: scoreBg(overall.score),
            }}>
              {scoreLabel(overall.score)}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
              {overall.displayText}
            </span>
          </div>
        )}

        {/* 右侧 — 各维度条形图 */}
        {dimensions.length > 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {dimensions.map(d => (
              <BarProgress key={d.label} item={d} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
