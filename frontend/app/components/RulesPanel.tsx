"use client";

import { useState, useEffect, useMemo } from "react";
import { Plus, Pencil, Trash2, Check, X, BookOpen, Sparkles, Image, Music, Video, FileText } from "lucide-react";
import { Rule, FileType } from "../../lib/types";
import { API_BASE, apiFetch } from "../../lib/supabase";

/* ─── 四类型定义 ──────────────────────────────────────────── */
const FILE_TYPES: { key: FileType; label: string; icon: typeof Image; color: string }[] = [
  { key: "image", label: "图片", icon: Image,    color: "var(--accent)" },
  { key: "audio", label: "音频", icon: Music,    color: "var(--green)" },
  { key: "video", label: "视频", icon: Video,    color: "var(--orange)" },
  { key: "text",  label: "文本", icon: FileText, color: "#8E8E93" },
];

/* ─── Prompt 模板提示词 ──────────────────────────────────── */
const PROMPT_TEMPLATES: Record<FileType, string> = {
  image: `请对这张图片进行专业打标分析，严格按以下格式输出（打标结果将直接写入导出的 Excel 文件，请保持格式规范）：

## Top3 核心标签
这是与图片内容相关性最高的3个标签（用于检索和分类的最重要关键词）：
- 标签1（最相关）
- 标签2
- 标签3

## 质量评分
- 清晰度：X/10
- 构图：X/10
- 色彩：X/10
- 商业价值：X/10
- 总分：X/10`,

  audio: `请对音频内容进行专业打标分析，严格按以下格式输出（打标结果将直接写入导出的 Excel 文件，请保持格式规范）：

## Top3 核心标签
这是与音频内容相关性最高的3个标签（最重要的分类关键词）：
- 标签1（最相关）
- 标签2
- 标签3

## 质量评分
- 音频清晰度：X/10
- 信息密度：X/10
- 表达流畅度：X/10
- 数据价值：X/10
- 总分：X/10`,

  video: `请对视频内容进行专业打标分析，严格按以下格式输出（打标结果将直接写入导出的 Excel 文件，请保持格式规范）：

## Top3 核心标签
这是与视频内容相关性最高的3个标签（最重要的分类关键词）：
- 标签1（最相关）
- 标签2
- 标签3

## 质量评分
- 画面质量：X/10
- 内容完整性：X/10
- 信息密度：X/10
- 商业价值：X/10
- 总分：X/10`,

  text: `请对文本内容进行专业打标分析，严格按以下格式输出（打标结果将直接写入导出的 Excel 文件，请保持格式规范）：

## Top3 核心标签
这是与文本内容相关性最高的3个标签（最重要的分类关键词）：
- 标签1（最相关）
- 标签2
- 标签3

## 质量评分
- 可读性：X/10
- 信息量：X/10
- 语言规范性：X/10
- 数据价值：X/10
- 总分：X/10`,
};

/* ─── 规则内容类型 ───────────────────────────────────────── */
interface RuleContent {
  prompt?: string;       // 旧版兼容：统一 prompt
  image?: string;        // 图片 prompt
  audio?: string;        // 音频 prompt
  video?: string;        // 视频 prompt
  text?: string;         // 文本 prompt
}

/** 从规则 content 中提取指定类型的 prompt */
export function getPromptForType(content: RuleContent | undefined, fileType: FileType): string {
  if (!content) return "";
  // 优先取分类型 prompt，回退到旧版统一 prompt
  return content[fileType] || content.prompt || "";
}

/** 检测规则是否有分类型 prompt */
function hasTypedPrompts(content: RuleContent | undefined): boolean {
  if (!content) return false;
  return !!(content.image || content.audio || content.video || content.text);
}

/* ─── 组件 ───────────────────────────────────────────────── */
interface Props {
  sessionId: string;
  activePrompt: string;
  filterType?: FileType;   // 传入则只展示该类型 tab（二级工作台使用）
  onSelectPrompt: (prompt: string) => void;
  /** 新增：应用分类型规则 */
  onSelectRule?: (content: RuleContent) => void;
}

export default function RulesPanel({ sessionId, activePrompt, filterType, onSelectPrompt, onSelectRule }: Props) {
  const [rules, setRules]         = useState<Rule[]>([]);
  const [isAdding, setIsAdding]   = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);

  // ── 新建/编辑表单状态 ──
  const [formName, setFormName]       = useState("");
  // 若有 filterType，默认锁定到对应类型
  const [formTab, setFormTab]         = useState<FileType>(filterType ?? "image");
  const [formPrompts, setFormPrompts] = useState<Record<FileType, string>>({
    image: "", audio: "", video: "", text: "",
  });

  // filterType 变化时同步 formTab
  useEffect(() => {
    if (filterType) setFormTab(filterType);
  }, [filterType]);

  // 只展示的类型列表（有 filterType 则只显示该类型）
  const visibleTypes = filterType
    ? FILE_TYPES.filter(ft => ft.key === filterType)
    : FILE_TYPES;

  const fetchRules = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/rules?session_id=${sessionId}`);
      const data = await res.json();
      if (Array.isArray(data)) setRules(data);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchRules(); }, [sessionId]);

  /* ── 重置表单 ── */
  const resetForm = () => {
    setFormName("");
    setFormTab(filterType ?? "image");
    setFormPrompts({ image: "", audio: "", video: "", text: "" });
  };

  /* ── 新建 ── */
  const handleStartAdd = () => {
    resetForm();
    setIsAdding(true);
    setEditingId(null);
  };

  const handleAdd = async () => {
    if (!formName.trim()) return;
    // 至少有一个类型有内容
    const hasContent = Object.values(formPrompts).some(v => v.trim());
    if (!hasContent) return;
    setLoading(true);

    // 构建 content：统一 prompt 取当前 tab 的内容 + 各分类型
    const content: RuleContent = { prompt: formPrompts[formTab] || "" };
    for (const ft of FILE_TYPES) {
      if (formPrompts[ft.key].trim()) {
        content[ft.key] = formPrompts[ft.key];
      }
    }

    await apiFetch(`${API_BASE}/rules`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, name: formName, content }),
    });
    resetForm(); setIsAdding(false);
    await fetchRules(); setLoading(false);
  };

  /* ── 编辑 ── */
  const startEdit = (r: Rule) => {
    setEditingId(r.id);
    setIsAdding(false);
    setFormName(r.name);
    const c = r.content as RuleContent;
    setFormPrompts({
      image: c?.image || c?.prompt || "",
      audio: c?.audio || "",
      video: c?.video || "",
      text:  c?.text  || "",
    });
    // 如果只有旧版 prompt，默认打到 image tab
    if (c?.image || c?.audio || c?.video || c?.text) {
      const first = FILE_TYPES.find(ft => c?.[ft.key]);
      setFormTab(first?.key || "image");
    } else {
      setFormTab("image");
    }
  };

  const handleUpdate = async (id: string) => {
    if (!formName.trim()) return;
    setLoading(true);
    const content: RuleContent = { prompt: formPrompts[formTab] || "" };
    for (const ft of FILE_TYPES) {
      if (formPrompts[ft.key].trim()) {
        content[ft.key] = formPrompts[ft.key];
      }
    }
    await apiFetch(`${API_BASE}/rules/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: formName, content }),
    });
    setEditingId(null); resetForm();
    await fetchRules(); setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除该规则？")) return;
    await apiFetch(`${API_BASE}/rules/${id}`, { method: "DELETE" });
    await fetchRules();
  };

  /* ── 应用规则 ── */
  const applyRule = (r: Rule) => {
    const c = r.content as RuleContent;
    if (onSelectRule && hasTypedPrompts(c)) {
      // 如果有 filterType，只传该类型 prompt 作为 prompt
      if (filterType && c[filterType]) {
        onSelectPrompt(c[filterType] as string);
      } else {
        onSelectRule(c);
      }
    } else {
      onSelectPrompt(c?.prompt || c?.image || c?.audio || c?.video || c?.text || "");
    }
  };;

  /* ── 规则卡片上的类型标签 ── */
  const getTypeBadges = (r: Rule) => {
    const c = r.content as RuleContent;
    if (!c) return [];
    return FILE_TYPES.filter(ft => c[ft.key]?.trim());
  };

  /* ── 编辑表单 (新建/编辑共用) ── */
  const renderForm = (mode: "add" | "edit", ruleId?: string) => {
    const currentPrompt = formPrompts[formTab];
    const template = PROMPT_TEMPLATES[formTab];
    const filledCount = FILE_TYPES.filter(ft => formPrompts[ft.key].trim()).length;
    // 进度只计算可见类型
    const visibleFilled = visibleTypes.filter(ft => formPrompts[ft.key].trim()).length;

    return (
      <div style={{ margin: mode === "add" ? "10px 10px 0" : 0, padding: 14, borderRadius: 14,
        background: "var(--accent-subtle)", border: "1px solid var(--accent-border)" }}
        className="anim-slide-up">

        {/* 规则名 */}
        <input autoFocus placeholder="规则名称（如：电商商品图标注）" value={formName}
          onChange={e => setFormName(e.target.value)}
          className="input" style={{ fontSize: 12, borderRadius: 9, marginBottom: 10 }} />

        {/* 类型 Tab 栏（filterType 时只显示单个类型，无需切换） */}
        {visibleTypes.length > 1 && (
          <div style={{ display: "flex", gap: 4, marginBottom: 10, background: "var(--bg-tertiary)",
            borderRadius: 10, padding: 3 }}>
            {visibleTypes.map(ft => {
              const Icon = ft.icon;
              const isActive = formTab === ft.key;
              const hasFilled = formPrompts[ft.key].trim().length > 0;
              return (
                <button key={ft.key} onClick={() => setFormTab(ft.key)}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 4, padding: "6px 0", fontSize: 11, fontWeight: isActive ? 600 : 400,
                    borderRadius: 8, border: "none", cursor: "pointer",
                    background: isActive ? "var(--bg-white)" : "transparent",
                    color: isActive ? ft.color : "var(--text-tertiary)",
                    boxShadow: isActive ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                    transition: "all 200ms var(--ease-smooth)",
                    position: "relative",
                  }}>
                  <Icon size={12} />
                  {ft.label}
                  {hasFilled && !isActive && (
                    <span style={{
                      position: "absolute", top: 3, right: 6,
                      width: 5, height: 5, borderRadius: "50%",
                      background: ft.color, opacity: 0.7,
                    }} />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* filterType 模式：显示类型标题 */}
        {visibleTypes.length === 1 && (
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8,
            padding:"5px 8px", borderRadius:8, background:"var(--bg-tertiary)" }}>
            {(() => { const ft = visibleTypes[0]; const Icon = ft.icon;
              return <><Icon size={12} style={{ color: ft.color }}/>
                <span style={{ fontSize:11, fontWeight:600, color:ft.color }}>{ft.label}专属提示词</span></>; })()}
          </div>
        )}

        {/* 填写进度（多类型时显示） */}
        {visibleTypes.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
              已配置 {filledCount}/4 类型
            </span>
            <div style={{ flex: 1, height: 2, borderRadius: 1, background: "var(--bg-tertiary)" }}>
              <div style={{
                width: `${(filledCount / 4) * 100}%`, height: "100%", borderRadius: 1,
                background: filledCount === 4 ? "var(--green)" : "var(--accent)",
                transition: "width 300ms var(--ease-smooth)",
              }} />
            </div>
          </div>
        )}

        {/* Prompt 输入区 */}
        <div style={{ position: "relative" }}>
          <textarea
            placeholder={template}
            value={currentPrompt}
            onChange={e => setFormPrompts(prev => ({ ...prev, [formTab]: e.target.value }))}
            rows={8}
            className="input textarea"
            style={{
              fontSize: 12, borderRadius: 10, lineHeight: 1.7,
              minHeight: 160, resize: "vertical",
            }} />

          {/* 填入模板按钮 */}
          {!currentPrompt.trim() && (
            <button
              onClick={() => setFormPrompts(prev => ({ ...prev, [formTab]: template }))}
              className="btn btn-glass"
              style={{
                position: "absolute", bottom: 10, right: 10,
                fontSize: 10, padding: "4px 10px", borderRadius: 7,
                gap: 4, background: "rgba(255,255,255,0.9)",
              }}>
              <Sparkles size={10} style={{ color: "var(--accent)" }} />
              填入模板
            </button>
          )}
        </div>

        {/* 操作按钮 */}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button
            onClick={mode === "add" ? handleAdd : () => handleUpdate(ruleId!)}
            disabled={loading}
            className="btn btn-success"
            style={{ fontSize: 11, padding: "5px 14px", borderRadius: 8 }}>
            <Check size={10} /> {mode === "add" ? "保存规则" : "更新规则"}
          </button>
          <button
            onClick={() => { mode === "add" ? setIsAdding(false) : setEditingId(null); resetForm(); }}
            className="btn btn-glass"
            style={{ fontSize: 11, padding: "5px 12px", borderRadius: 8 }}>
            <X size={10} /> 取消
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 头部 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "11px 12px", borderBottom: "0.5px solid var(--separator)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <BookOpen size={13} style={{ color: "var(--accent)" }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>规则库</span>
          <span style={{ fontSize: 10, color: "var(--text-tertiary)", background: "var(--bg-tertiary)",
            padding: "1px 6px", borderRadius: 6 }}>{rules.length}</span>
        </div>
        <button onClick={handleStartAdd}
          className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 11, borderRadius: 8, height: 26 }}>
          <Plus size={11} /> 新建
        </button>
      </div>

      {/* 新建表单 */}
      {isAdding && renderForm("add")}

      {/* 规则列表 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 8px", minHeight: 0 }}>
        {rules.length === 0 && !isAdding && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: 140, gap: 10, color: "var(--text-tertiary)" }}>
            <Sparkles size={22} strokeWidth={1.5} />
            <p style={{ fontSize: 12 }}>点击「新建」添加打标规则</p>
            <p style={{ fontSize: 10, textAlign: "center", lineHeight: 1.6, maxWidth: 180 }}>
              支持为图片、音频、视频、文本<br/>分别定义不同的 Prompt
            </p>
          </div>
        )}

        {rules.map((r, i) => {
          const c = r.content as RuleContent;
          const mainPrompt = c?.prompt || c?.image || c?.audio || c?.video || c?.text || "";
          const isActive = activePrompt === mainPrompt;
          const badges = getTypeBadges(r);
          const isEditing = editingId === r.id;

          return (
            <div key={r.id}
              style={{
                borderRadius: 12, padding: 12, marginBottom: 6,
                background: isActive ? "var(--accent-subtle)" : "var(--bg-secondary)",
                border: `0.5px solid ${isActive ? "var(--accent-border)" : "transparent"}`,
                outline: isActive ? "1px solid var(--accent-border)" : "none",
                transition: "all 200ms var(--ease-smooth)",
                animationDelay: `${i * 35}ms`,
              }}
              className="anim-fade">

              {isEditing ? (
                renderForm("edit", r.id)
              ) : (
                <>
                  {/* 标题行 */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      color: isActive ? "var(--accent)" : "var(--text-primary)" }}>
                      {r.name}
                    </span>
                    <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                      <button onClick={() => startEdit(r)} className="btn btn-glass"
                        style={{ width: 24, height: 24, padding: 0, borderRadius: 7, color: "var(--text-tertiary)" }}>
                        <Pencil size={10} />
                      </button>
                      <button onClick={() => handleDelete(r.id)} className="btn"
                        style={{ width: 24, height: 24, padding: 0, borderRadius: 7,
                          color: "var(--text-tertiary)", background: "transparent" }}
                        onMouseEnter={e => (e.currentTarget.style.color = "var(--red)")}
                        onMouseLeave={e => (e.currentTarget.style.color = "var(--text-tertiary)")}>
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>

                  {/* 类型标签 */}
                  {badges.length > 0 && (
                    <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
                      {badges.map(ft => {
                        const Icon = ft.icon;
                        return (
                          <span key={ft.key} style={{
                            display: "inline-flex", alignItems: "center", gap: 3,
                            fontSize: 10, padding: "2px 7px", borderRadius: 6,
                            background: `${ft.color}11`, color: ft.color, fontWeight: 500,
                          }}>
                            <Icon size={9} /> {ft.label}
                          </span>
                        );
                      })}
                      {!hasTypedPrompts(c) && (
                        <span style={{
                          fontSize: 10, padding: "2px 7px", borderRadius: 6,
                          background: "var(--bg-tertiary)", color: "var(--text-tertiary)",
                        }}>
                          通用规则
                        </span>
                      )}
                    </div>
                  )}

                  {/* 预览 */}
                  <p className="line-clamp-2"
                    style={{ fontSize: 11, lineHeight: 1.6, color: "var(--text-tertiary)", marginBottom: 8 }}>
                    {mainPrompt}
                  </p>

                  {/* 应用按钮 */}
                  <button onClick={() => applyRule(r)}
                    className={`btn ${isActive ? "btn-primary" : "btn-glass"}`}
                    style={{ width: "100%", height: 28, borderRadius: 8, fontSize: 11, justifyContent: "center" }}>
                    {isActive ? <><Check size={10} /> 当前使用</> : "应用规则"}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
