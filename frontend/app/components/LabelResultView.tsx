"use client";

import { useMemo } from "react";
import { parseScores } from "../../lib/scoreParser";
import ScoreVisualize from "./ScoreVisualize";

/* ═══════════════════════════════════════════════════════════════
   LabelResultView — 通用打标结果可视化
   ─────────────────────────────────────────────────────────────
   自动检测 AI 输出结构，按以下优先级渲染：
   1. 若含评分 → ScoreVisualize 评分图表
   2. 若含标签列表 → 彩色标签云
   3. 若含分类/类别 → 分类卡片
   4. 若含描述/摘要 → 高亮文本块
   5. 其余结构化 section → 折叠面板
   6. 始终在底部显示原始文本（可折叠）
═══════════════════════════════════════════════════════════════ */

interface Section {
  title: string;
  type: "top3" | "tags" | "scene" | "category" | "desc" | "scores" | "text";
  items: string[];
  raw: string;
}

/* ─── 解析 markdown → 结构化 sections ─────────────────────── */
function parseResult(text: string): Section[] {
  if (!text?.trim()) return [];

  const sections: Section[] = [];
  // 按 h2/h3 标题或 **标题** 分块
  const chunks = text
    .split(/\n(?=#{1,3}\s|(?:\*\*[^*\n]{2,20}\*\*\s*[:：\n]))/g)
    .filter(c => c.trim());

  for (const chunk of chunks) {
    const lines = chunk.trim().split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // 提取标题
    let title = "";
    let bodyLines = lines;

    const headMatch = lines[0].match(/^#{1,3}\s+(.+)|^\*\*([^*]+)\*\*\s*[:：]?/);
    if (headMatch) {
      title = (headMatch[1] || headMatch[2] || "").trim();
      bodyLines = lines.slice(1).filter(l => l.trim() && !/^#{1,3}\s/.test(l));
    } else {
      title = "分析结果";
      bodyLines = lines;
    }

    // 提取列表项（支持 - / * / • / 数字. 等格式）
    const listItems = bodyLines
      .filter(l => /^[-*•·]|^\d+[.、]/.test(l))
      .map(l => l.replace(/^[-*•·]\s*|^\d+[.、]\s*/g, "").trim())
      .filter(l => l.length > 0 && l.length < 80);

    const plainText = bodyLines
      .filter(l => !/^[-*•·]|^\d+[.、]/.test(l))
      .join("\n")
      .trim();

    // 判断 section 类型
    const titleLower = title.toLowerCase();
    let type: Section["type"] = "text";
    if (/top3|核心标签|最相关/i.test(titleLower)) {
      type = "top3";
    } else if (/质量评分|评分|score/i.test(titleLower)) {
      type = "scores";
    } else if (/标签|tag|关键词|keyword/i.test(titleLower)) {
      type = "tags";
    } else if (/推荐使用场景|使用场景|应用场景|适用场景/i.test(titleLower)) {
      type = "scene";
    } else if (/分类|类别|类型|category|genre|label/i.test(titleLower)) {
      type = "category";
    } else if (/描述|摘要|简介|内容|summary|description|overview/i.test(titleLower)) {
      type = "desc";
    }

    const items = type === "scores"
      // 评分 section：把所有非空行（含 **bold**）全部放进 items 供解析
      ? bodyLines.filter(l => l.length > 0)
      : listItems.length > 0 ? listItems : (plainText ? [plainText] : []);
    if (items.length === 0) continue;

    sections.push({ title, type, items, raw: bodyLines.join("\n") });
  }

  if (sections.length === 0 && text.trim()) {
    sections.push({
      title: "打标结果",
      type: "desc",
      items: [text.trim()],
      raw: text.trim(),
    });
  }

  return sections;
}

/* ─── 标签色盘 ─────────────────────────────────────────────── */
const TAG_COLORS = [
  { bg: "rgba(0,122,255,0.08)",   text: "#007AFF" },
  { bg: "rgba(52,199,89,0.08)",   text: "#28A745" },
  { bg: "rgba(255,149,0,0.10)",   text: "#D4790A" },
  { bg: "rgba(175,82,222,0.08)",  text: "#AF52DE" },
  { bg: "rgba(90,200,250,0.10)",  text: "#0A84FF" },
  { bg: "rgba(255,59,48,0.08)",   text: "#FF3B30" },
  { bg: "rgba(255,204,0,0.10)",   text: "#B8860B" },
  { bg: "rgba(48,209,88,0.08)",   text: "#1A8A3C" },
];

function tagColor(idx: number) {
  return TAG_COLORS[idx % TAG_COLORS.length];
}

/* ─── 标签云 ─────────────────────────────────────────────── */
function TagCloud({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="anim-fade-up">
      <SectionLabel icon="🏷️" title={title} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {items.map((tag, i) => {
          const { bg, text } = tagColor(i);
          return (
            <span key={tag + i} style={{
              padding: "4px 10px", borderRadius: 20,
              fontSize: 12, fontWeight: 500,
              background: bg, color: text,
              border: `0.5px solid ${text}30`,
              transition: "transform 150ms, box-shadow 150ms",
              cursor: "default",
            }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.transform = "scale(1.05)";
                (e.currentTarget as HTMLElement).style.boxShadow = `0 2px 8px ${text}30`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.transform = "";
                (e.currentTarget as HTMLElement).style.boxShadow = "";
              }}
            >
              {tag}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ─── 分类卡片 ─────────────────────────────────────────────── */
const CATEGORY_ICONS: Record<string, string> = {
  "建筑": "🏢", "人物": "👤", "风景": "🌄", "美食": "🍽️", "动物": "🐾",
  "科技": "💻", "艺术": "🎨", "体育": "⚽", "交通": "🚗", "医疗": "🏥",
  "教育": "📚", "娱乐": "🎭", "新闻": "📰", "商业": "💼", "自然": "🌿",
};

function getCategoryIcon(name: string) {
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (name.includes(key)) return icon;
  }
  return "📂";
}

function CategoryCards({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="anim-fade-up">
      <SectionLabel icon="📂" title={title} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {items.map((cat, i) => {
          const { bg, text } = tagColor(i + 2);
          const icon = getCategoryIcon(cat);
          return (
            <div key={cat + i} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 12,
              background: bg, border: `0.5px solid ${text}25`,
              fontSize: 12, fontWeight: 600, color: text,
            }}>
              <span style={{ fontSize: 14 }}>{icon}</span>
              {cat}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Top3 核心标签（高亮卡片样式） ──────────────────────── */
const TOP3_MEDALS = ["🥇", "🥈", "🥉"];
const TOP3_COLORS = [
  { bg: "rgba(26,86,255,0.10)", border: "rgba(26,86,255,0.30)", text: "#1A56FF" },
  { bg: "rgba(99,102,241,0.10)", border: "rgba(99,102,241,0.28)", text: "#6366F1" },
  { bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.22)", text: "#8B5CF6" },
];

function Top3Block({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="anim-fade-up">
      <SectionLabel icon="🏆" title={title} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {items.slice(0, 3).map((tag, i) => {
          const c = TOP3_COLORS[i] || TOP3_COLORS[2];
          // 清洗：去掉"标签1（最相关）" → 只保留内容
          const cleaned = tag.replace(/^标签\d+\s*[:：]?\s*/, "").replace(/[（(].*?[）)]/g, "").trim();
          return (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 14px", borderRadius: 12,
              background: c.bg, border: `1px solid ${c.border}`,
              fontSize: 13, fontWeight: 600, color: c.text,
              transition: "transform 150ms",
            }}
              onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.02)")}
              onMouseLeave={e => (e.currentTarget.style.transform = "")}
            >
              <span style={{ fontSize: 16 }}>{TOP3_MEDALS[i]}</span>
              {cleaned || tag}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── 推荐使用场景 ──────────────────────────────────────────── */
function SceneBlock({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="anim-fade-up">
      <SectionLabel icon="🎯" title={title} />
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
        {items.map((scene, i) => {
          // 清洗 "场景1：" 前缀
          const cleaned = scene.replace(/^场景\d+\s*[:：]\s*/, "").trim();
          return (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "7px 12px", borderRadius: 10,
              background: "var(--accent-subtle)",
              border: "0.5px solid var(--accent-border)",
              fontSize: 12, color: "var(--accent)", fontWeight: 500,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: 6,
                background: "var(--accent)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700, flexShrink: 0,
              }}>{i + 1}</span>
              {cleaned || scene}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── 质量评分紧凑表格 ──────────────────────────────────────── */
function ScoreGridBlock({ items, title }: { items: string[]; title: string }) {
  // 解析 "维度：X/10" 或 "维度：X分" 格式
  const scoreRows: { label: string; display: string; pct: number; na: boolean }[] = [];
  for (const raw of items) {
    // 清洗 **xxx** markdown
    const cleaned = raw.replace(/\*\*/g, "").trim();
    // 匹配 "xxx：X/10" 或 "xxx: X/10"
    const m = cleaned.match(/^([^：:]+)[：:]\s*(\d+(?:\.\d+)?)\s*[/／]\s*(\d+)/);
    const naMatch = cleaned.match(/^([^：:]+)[：:]\s*[Nn][/\/]?[Aa]/);
    if (m) {
      const raw2 = parseFloat(m[2]);
      const max  = parseFloat(m[3]);
      scoreRows.push({ label: m[1].trim(), display: `${m[2]}/${m[3]}`, pct: (raw2 / max) * 100, na: false });
    } else if (naMatch) {
      scoreRows.push({ label: naMatch[1].trim(), display: "N/A", pct: 0, na: true });
    } else if (/^[^：:]+[：:].+/.test(cleaned)) {
      // 有冒号但不是分数 → 跳过（避免显示解释文字）
      continue;
    }
  }

  if (scoreRows.length === 0) return null;

  return (
    <div className="anim-fade-up">
      <SectionLabel icon="📊" title={title} />
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
        {scoreRows.map((row, i) => {
          const color = row.na ? "var(--text-quaternary)"
            : row.pct >= 80 ? "var(--green)"
            : row.pct >= 60 ? "var(--accent)"
            : "var(--orange)";
          return (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", borderRadius: 9,
              background: "var(--bg-secondary)",
            }}>
              <span style={{ width: 60, fontSize: 11, fontWeight: 500,
                color: "var(--text-secondary)", flexShrink: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.label}
              </span>
              {row.na ? (
                <span style={{ flex: 1, fontSize: 11, color: "var(--text-quaternary)" }}>N/A</span>
              ) : (
                <div style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--bg-tertiary)" }}>
                  <div style={{ height: "100%", borderRadius: 3, background: color,
                    width: `${row.pct}%`, transition: "width 600ms var(--ease-smooth)" }} />
                </div>
              )}
              <span style={{ width: 36, fontSize: 12, fontWeight: 700, color,
                textAlign: "right", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                {row.display}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── 标签占比饼图（SVG 环形） ────────────────────────────── */
function TagPieChart({ items, title }: { items: string[]; title: string }) {
  // 最多显示 8 个标签，超出归入"其他"
  const MAX_SLICES = 8;
  const shown = items.slice(0, MAX_SLICES);
  const rest  = items.length - shown.length;
  const slices = rest > 0 ? [...shown, `其他 (${rest})`] : shown;

  // 均分饼图（每个标签占比相等）
  const total  = slices.length;
  const colors = [
    "#007AFF","#34C759","#FF9F0A","#AF52DE","#0A84FF","#FF3B30","#B8860B","#1A8A3C","#5856D6",
  ];

  // SVG 环形
  const R = 40; // 外半径
  const r = 24; // 内半径（环形）
  const CX = 56; const CY = 56;
  let startAngle = -Math.PI / 2;
  const arcData = slices.map((_, i) => {
    const angle = (2 * Math.PI) / total;
    const endAngle = startAngle + angle - 0.015; // 小间隙
    const x1 = CX + R * Math.cos(startAngle);
    const y1 = CY + R * Math.sin(startAngle);
    const x2 = CX + R * Math.cos(endAngle);
    const y2 = CY + R * Math.sin(endAngle);
    const x3 = CX + r * Math.cos(endAngle);
    const y3 = CY + r * Math.sin(endAngle);
    const x4 = CX + r * Math.cos(startAngle);
    const y4 = CY + r * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const d = `M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R},0,${largeArc},1,${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} A${r},${r},0,${largeArc},0,${x4.toFixed(2)},${y4.toFixed(2)} Z`;
    const color = colors[i % colors.length];
    startAngle += (2 * Math.PI) / total;
    return { d, color, label: slices[i] };
  });

  return (
    <div className="anim-fade-up">
      <SectionLabel icon="🥧" title={title} />
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
        {/* SVG 环形图 */}
        <svg width={112} height={112} viewBox="0 0 112 112" style={{ flexShrink: 0 }}>
          {arcData.map((arc, i) => (
            <path key={i} d={arc.d} fill={arc.color} opacity={0.88} />
          ))}
          {/* 中心文字 */}
          <text x={CX} y={CY - 4} textAnchor="middle" fontSize={9} fill="var(--text-tertiary)" fontWeight={600}>
            {total}
          </text>
          <text x={CX} y={CY + 8} textAnchor="middle" fontSize={8} fill="var(--text-quaternary)">
            个标签
          </text>
        </svg>
        {/* 图例 */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 100 }}>
          {arcData.map((arc, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: arc.color, flexShrink: 0 }} />
              <span style={{
                fontSize: 11, color: "var(--text-secondary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: 140,
              }}>{arc.label}</span>
              <span style={{ fontSize: 10, color: "var(--text-quaternary)", marginLeft: "auto", flexShrink: 0 }}>
                {Math.round(100 / total)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


function DescBlock({ items, title }: { items: string[]; title: string }) {
  const text = items.join("\n");
  return (
    <div className="anim-fade-up">
      <SectionLabel icon="📝" title={title} />
      <div style={{
        marginTop: 8, padding: "10px 14px", borderRadius: 12,
        background: "var(--bg-secondary)", border: "0.5px solid var(--separator)",
        fontSize: 13, lineHeight: 1.75, color: "var(--text-secondary)",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
        borderLeft: "3px solid var(--accent)",
      }}>
        {text}
      </div>
    </div>
  );
}

/* ─── 通用列表块 ─────────────────────────────────────────────── */
function ListBlock({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="anim-fade-up">
      <SectionLabel icon="📋" title={title} />
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((item, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            padding: "5px 10px", borderRadius: 8,
            background: "var(--bg-secondary)", fontSize: 12, lineHeight: 1.6,
            color: "var(--text-secondary)",
          }}>
            <span style={{
              width: 18, height: 18, borderRadius: "50%",
              background: "var(--accent-subtle)", color: "var(--accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 700, flexShrink: 0, marginTop: 1,
            }}>{i + 1}</span>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Section 标题 ─────────────────────────────────────────── */
function SectionLabel({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", letterSpacing: "0.02em" }}>
        {title.toUpperCase()}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   主组件
═══════════════════════════════════════════════════════════════ */
interface Props {
  result?: string;
  compact?: boolean;   // true = 右侧面板紧凑模式  false = 弹窗完整模式
}

export default function LabelResultView({ result, compact = false }: Props) {
  const scored  = useMemo(() => parseScores(result), [result]);
  const sections = useMemo(() => parseResult(result ?? ""), [result]);

  if (!result?.trim()) return null;

  // 按类型提取各 section
  const scoresSec  = sections.find(s => s.type === "scores");
  const top3Sec    = sections.find(s => s.type === "top3");
  const tagsSec    = sections.find(s => s.type === "tags");

  // 其他不渲染的类型：desc, scene（用户要求隐藏）
  // category 仍然渲染，text 仍然渲染

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 10 : 14 }}>

      {/* 1. 质量评分（ScoreVisualize 环形图，仅弹窗完整模式）*/}
      {scored.hasScores && !compact && <ScoreVisualize result={result} compact={false} />}

      {/* 2. 评分条形网格（ScoreGridBlock）— 始终优先渲染 */}
      {scoresSec && <ScoreGridBlock title={scoresSec.title} items={scoresSec.items} />}

      {/* 3. TOP3 核心标签 */}
      {top3Sec && <Top3Block title={top3Sec.title} items={top3Sec.items} />}

      {/* 4. 标签占比饼图（来自 tags section） */}
      {tagsSec && tagsSec.items.length > 0 && (
        <TagPieChart title="标签占比分布" items={tagsSec.items} />
      )}

      {/* 5. 其他结构化内容（category、text，隐藏 desc 和 scene） */}
      {sections.map((sec, i) => {
        // 已单独渲染的 section 跳过
        if (sec.type === "scores" || sec.type === "top3" || sec.type === "tags") return null;
        // 用户要求隐藏的 section
        if (sec.type === "desc" || sec.type === "scene") return null;

        if (sec.type === "category") {
          return <CategoryCards key={i} title={sec.title} items={sec.items} />;
        }
        // 通用 text
        if (sec.items.length === 1 && sec.items[0].length > 40) {
          return <DescBlock key={i} title={sec.title} items={sec.items} />;
        }
        return <ListBlock key={i} title={sec.title} items={sec.items} />;
      })}

      {/* 6. 若完全没有解析到结构化内容（sections 为空），显示原始文本 */}
      {sections.length === 0 && (
        <div style={{
          padding: "10px 14px", borderRadius: 12,
          background: "var(--bg-secondary)", border: "0.5px solid var(--separator)",
          fontSize: 13, lineHeight: 1.75, color: "var(--text-secondary)",
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {result}
        </div>
      )}
    </div>
  );
}
