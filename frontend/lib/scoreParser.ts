/**
 * 分数解析器 — 从 AI 打标结果中智能提取分数
 *
 * 支持的格式：
 *   1. "总分：85/100"  "总分: 8.5/10"  "Overall Score: 92"
 *   2. "清晰度：8/10"  "色彩：9分"  "构图: 7.5"
 *   3. "评分：★★★★☆"  "⭐⭐⭐⭐"
 *   4. JSON 格式 { "score": 85, "items": [...] }
 */

export interface ScoreItem {
  label: string;       // 维度名  如 "清晰度"
  score: number;       // 归一化到 0-100
  rawScore: number;    // 原始分数
  maxScore: number;    // 满分
  displayText: string; // 原始展示文本  如 "8.5/10"
}

export interface ParsedScores {
  overall: ScoreItem | null;    // 总分
  dimensions: ScoreItem[];      // 各维度分数
  hasScores: boolean;           // 是否检测到分数
}

// ─── 匹配总分 ─────────────────────────────────────────────────
const OVERALL_PATTERNS = [
  // "总分：85/100"  "总体评分：8.5/10"  "Overall Score: 92/100"
  /(?:总分|总体评分|综合评分|综合得分|overall\s*score|total\s*score|final\s*score)[：:\s]*(\d+(?:\.\d+)?)\s*[/／]\s*(\d+)/i,
  // "总分：85分"  "总体评分：85"
  /(?:总分|总体评分|综合评分|综合得分|overall\s*score|total\s*score|final\s*score)[：:\s]*(\d+(?:\.\d+)?)\s*分?/i,
  // "评分：★★★★☆" → 按星算
  /(?:总分|总体评分|综合评分|评分|rating)[：:\s]*((?:[★⭐])+(?:[☆])*)/i,
];

// ─── 匹配各维度分数 ───────────────────────────────────────────
// "清晰度：8/10"  "色彩: 9.0/10"  "画面质量：85/100"
const DIM_SCORE_PATTERN = /([一-龥\w]{2,10})[：:\s]+(\d+(?:\.\d+)?)\s*[/／]\s*(\d+)/g;
// "清晰度：8分"  "色彩: 9"
const DIM_PLAIN_PATTERN = /([一-龥]{2,8})[：:\s]+(\d+(?:\.\d+)?)\s*分/g;

function countStars(s: string): { score: number; max: number } {
  const filled = (s.match(/[★⭐]/g) || []).length;
  const empty  = (s.match(/[☆]/g) || []).length;
  const max = filled + empty || 5;
  return { score: filled, max };
}

function normalize(score: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((score / max) * 100)));
}

export function parseScores(text: string | undefined | null): ParsedScores {
  const empty: ParsedScores = { overall: null, dimensions: [], hasScores: false };
  if (!text) return empty;

  let overall: ScoreItem | null = null;
  const dimensions: ScoreItem[] = [];
  const usedRanges: [number, number][] = [];  // 防止重复匹配

  // 1. 先尝试解析 JSON
  try {
    const jsonMatch = text.match(/\{[\s\S]*"score"[\s\S]*\}/);
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]);
      if (typeof obj.score === "number") {
        const max = obj.max ?? (obj.score > 10 ? 100 : 10);
        overall = {
          label: "总分", score: normalize(obj.score, max),
          rawScore: obj.score, maxScore: max,
          displayText: `${obj.score}/${max}`,
        };
      }
      if (Array.isArray(obj.items || obj.dimensions || obj.scores)) {
        for (const item of (obj.items || obj.dimensions || obj.scores)) {
          if (item.label && typeof item.score === "number") {
            const max = item.max ?? (item.score > 10 ? 100 : 10);
            dimensions.push({
              label: item.label, score: normalize(item.score, max),
              rawScore: item.score, maxScore: max,
              displayText: `${item.score}/${max}`,
            });
          }
        }
      }
      if (overall || dimensions.length > 0) {
        return { overall, dimensions, hasScores: true };
      }
    }
  } catch { /* not JSON, continue */ }

  // 2. 匹配总分
  for (const pat of OVERALL_PATTERNS) {
    const m = text.match(pat);
    if (!m) continue;
    if (m[1] && /[★⭐]/.test(m[1])) {
      const { score, max } = countStars(m[1]);
      overall = {
        label: "总分", score: normalize(score, max),
        rawScore: score, maxScore: max,
        displayText: m[1],
      };
    } else if (m[1] && m[2]) {
      const raw = parseFloat(m[1]);
      const max = parseFloat(m[2]);
      overall = {
        label: "总分", score: normalize(raw, max),
        rawScore: raw, maxScore: max,
        displayText: `${raw}/${max}`,
      };
    } else if (m[1]) {
      const raw = parseFloat(m[1]);
      const max = raw > 10 ? 100 : 10;
      overall = {
        label: "总分", score: normalize(raw, max),
        rawScore: raw, maxScore: max,
        displayText: `${raw}/${max}`,
      };
    }
    if (overall) {
      usedRanges.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
      break;
    }
  }

  // 3. 匹配各维度 (xx：n/m)
  let dimMatch;
  const dimPattern1 = new RegExp(DIM_SCORE_PATTERN.source, "g");
  while ((dimMatch = dimPattern1.exec(text)) !== null) {
    const start = dimMatch.index;
    const end = start + dimMatch[0].length;
    // 跳过已被总分匹配的区域
    if (usedRanges.some(([s, e]) => start >= s && start < e)) continue;

    const label = dimMatch[1];
    const raw   = parseFloat(dimMatch[2]);
    const max   = parseFloat(dimMatch[3]);
    // 过滤掉明显非维度的（纯英文短词，数字等）
    if (/^\d+$/.test(label)) continue;
    dimensions.push({
      label, score: normalize(raw, max),
      rawScore: raw, maxScore: max,
      displayText: `${raw}/${max}`,
    });
  }

  // 4. 匹配 "xx：n分" 形式（仅当前面没找到够多维度时）
  if (dimensions.length < 2) {
    const dimPattern2 = new RegExp(DIM_PLAIN_PATTERN.source, "g");
    while ((dimMatch = dimPattern2.exec(text)) !== null) {
      const label = dimMatch[1];
      const raw   = parseFloat(dimMatch[2]);
      if (/^\d+$/.test(label)) continue;
      const existing = dimensions.find(d => d.label === label);
      if (existing) continue;
      const max = raw > 10 ? 100 : 10;
      dimensions.push({
        label, score: normalize(raw, max),
        rawScore: raw, maxScore: max,
        displayText: `${raw}分`,
      });
    }
  }

  // 5. 如果没有总分但有维度，算平均分
  if (!overall && dimensions.length >= 2) {
    const avg = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
    overall = {
      label: "综合均分", score: avg,
      rawScore: avg, maxScore: 100,
      displayText: `${avg}/100`,
    };
  }

  return {
    overall,
    dimensions,
    hasScores: overall !== null || dimensions.length > 0,
  };
}
