#!/usr/bin/env python3
"""
fetch_aa_models.py
==================
抓取 Artificial Analysis 多模态榜单数据，生成 models_snapshot.json。
运行方式：
  python fetch_aa_models.py                 # 直接更新快照
  python fetch_aa_models.py --dry-run       # 仅打印，不写文件
  python fetch_aa_models.py --output /path  # 指定输出路径

定时运行（每周一 3:00 AM）配置示例（crontab）：
  0 3 * * 1  cd /Users/qwinyuen/ai-labeler/ai-worker && .venv/bin/python fetch_aa_models.py
"""
import re
import sys
import json
import time
import argparse
import traceback
from datetime import datetime, timezone
from pathlib import Path

try:
    import httpx
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "httpx"], check=True)
    import httpx

# ── 输出路径 ────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
DEFAULT_SNAPSHOT_PATH = SCRIPT_DIR / "models_snapshot.json"

# ── AA 数据源（公开 JSON API） ─────────────────────────────────────────────
AA_API_URL = "https://artificialanalysis.ai/api/text/models?full=true"
AA_LEADERBOARD_URL = "https://artificialanalysis.ai/leaderboards/models"

# ── 固定的人工筛选规则 ─────────────────────────────────────────────────────
# slug 字段：来自 AA 模型页 URL（/models/{slug}）
# modalities 允许 image / video / audio / text
# recommended_for：对应打标场景
PINNED_MODELS = [
    {
        "slug":           "gemini-2-5-pro",
        "label":          "Gemini 2.5 Pro",
        "icon":           "🏆",
        "tag":            "综合最强",
        "baseUrl":        "https://generativelanguage.googleapis.com/v1beta/openai",
        "visionModel":    "gemini-2.5-pro-preview-03-25",
        "textModel":      "gemini-2.5-pro-preview-03-25",
        "videoMode":      "native",
        "apiKeyUrl":      "https://aistudio.google.com/apikey",
        "recommend":      ["image", "video", "audio"],
        # 来自 AA 浏览器获取的基准值（API不可用时使用）
        "_fallback": {"intelligence": 35, "speedTps": 124, "priceInput": 1.25, "priceOutput": 10.0,
                      "contextWindow": 1000000, "knowledgeCutoff": "2025-01",
                      "supportsImage": True, "supportsVideo": True, "supportsAudio": True},
    },
    {
        "slug":           "gemini-2-5-flash",
        "label":          "Gemini 2.5 Flash",
        "icon":           "⚡",
        "tag":            "极速性价比",
        "baseUrl":        "https://generativelanguage.googleapis.com/v1beta/openai",
        "visionModel":    "gemini-2.5-flash-preview-04-17",
        "textModel":      "gemini-2.5-flash-preview-04-17",
        "videoMode":      "native",
        "apiKeyUrl":      "https://aistudio.google.com/apikey",
        "recommend":      ["image", "video", "audio", "text"],
        "_fallback": {"intelligence": 27, "speedTps": 226, "priceInput": 0.3, "priceOutput": 2.5,
                      "contextWindow": 1000000, "knowledgeCutoff": "2025-01",
                      "supportsImage": True, "supportsVideo": True, "supportsAudio": True},
    },
    {
        "slug":           "claude-3-7-sonnet",
        "label":          "Claude 3.7 Sonnet",
        "icon":           "🧠",
        "tag":            "图文推荐",
        "baseUrl":        "https://api.anthropic.com/v1",
        "visionModel":    "claude-3-7-sonnet-20250219",
        "textModel":      "claude-3-7-sonnet-20250219",
        "videoMode":      "frames",
        "apiKeyUrl":      "https://console.anthropic.com/settings/keys",
        "recommend":      ["image", "text"],
        "_fallback": {"intelligence": 35, "speedTps": None, "priceInput": 3.0, "priceOutput": 15.0,
                      "contextWindow": 200000, "knowledgeCutoff": "2024-10",
                      "supportsImage": True, "supportsVideo": False, "supportsAudio": False},
    },
    {
        "slug":           "gpt-4-1",
        "label":          "GPT-4.1",
        "icon":           "🤖",
        "tag":            "图像理解",
        "baseUrl":        "https://api.openai.com/v1",
        "visionModel":    "gpt-4.1",
        "textModel":      "gpt-4.1",
        "videoMode":      "frames",
        "apiKeyUrl":      "https://platform.openai.com/api-keys",
        "recommend":      ["image", "text"],
        "_fallback": {"intelligence": 26, "speedTps": 87, "priceInput": 2.0, "priceOutput": 8.0,
                      "contextWindow": 1000000, "knowledgeCutoff": "2024-05",
                      "supportsImage": True, "supportsVideo": False, "supportsAudio": False},
    },
    {
        "slug":           "qwen2-5-vl-72b-instruct",
        "label":          "Qwen2.5-VL 原生视频",
        "icon":           "🎬",
        "tag":            "视频推荐",
        "baseUrl":        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "visionModel":    "qwen2.5-vl-72b-instruct",
        "textModel":      "qwen-max",
        "videoMode":      "native",
        "apiKeyUrl":      "https://bailian.console.aliyun.com/?apiKey=1#/api-key",
        "recommend":      ["video", "image"],
        "_fallback": {"intelligence": None, "supportsImage": True, "supportsVideo": True,
                      "supportsAudio": False, "contextWindow": 32000},
    },
    {
        "slug":           "qwen-omni-turbo",
        "label":          "Qwen-Omni Turbo",
        "icon":           "🎙️",
        "tag":            "音频推荐",
        "baseUrl":        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "visionModel":    "qwen-omni-turbo",
        "textModel":      "qwen-omni-turbo",
        "videoMode":      "native",
        "apiKeyUrl":      "https://bailian.console.aliyun.com/?apiKey=1#/api-key",
        "recommend":      ["audio", "video"],
        "_fallback": {"supportsImage": True, "supportsVideo": True, "supportsAudio": True},
    },
    {
        "slug":           "qwen2-5-vl-siliconflow",
        "label":          "硅基 Qwen2.5-VL",
        "icon":           "💎",
        "tag":            "国内中转",
        "baseUrl":        "https://api.siliconflow.cn/v1",
        "visionModel":    "Qwen/Qwen2.5-VL-72B-Instruct",
        "textModel":      "Qwen/Qwen2.5-72B-Instruct",
        "videoMode":      "frames",
        "apiKeyUrl":      "https://cloud.siliconflow.cn/account/ak",
        "recommend":      ["video", "image"],
        "_fallback": {"supportsImage": True, "supportsVideo": True, "supportsAudio": False},
    },
    {
        "slug":           "gpt-4o-mini",
        "label":          "GPT-4o mini",
        "icon":           "💰",
        "tag":            "经济图像",
        "baseUrl":        "https://api.openai.com/v1",
        "visionModel":    "gpt-4o-mini",
        "textModel":      "gpt-4o-mini",
        "videoMode":      "frames",
        "apiKeyUrl":      "https://platform.openai.com/api-keys",
        "recommend":      ["image"],
        "_fallback": {"intelligence": 13, "speedTps": 40, "priceInput": 0.15, "priceOutput": 0.6,
                      "contextWindow": 128000, "knowledgeCutoff": "2023-10",
                      "supportsImage": True, "supportsVideo": False, "supportsAudio": False},
    },
    {
        "slug":           "deepseek-v3",
        "label":          "DeepSeek-V3",
        "icon":           "🌊",
        "tag":            "纯文本",
        "baseUrl":        "https://api.deepseek.com/v1",
        "visionModel":    "deepseek-chat",
        "textModel":      "deepseek-chat",
        "videoMode":      "frames",
        "apiKeyUrl":      "https://platform.deepseek.com/api_keys",
        "recommend":      ["text"],
        "_fallback": {"intelligence": 22, "speedTps": None, "priceInput": 0.27, "priceOutput": 1.1,
                      "contextWindow": 128000,
                      "supportsImage": False, "supportsVideo": False, "supportsAudio": False},
    },
]


def fetch_aa_data(timeout: int = 30) -> dict:
    """
    从 AA 公开 API 获取模型列表（包含 intelligence_index、speed、price 等）。
    如果 API 不可用则返回空 dict，降级使用固定快照。
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, */*",
        "Referer": "https://artificialanalysis.ai/",
    }
    try:
        resp = httpx.get(AA_API_URL, headers=headers, timeout=timeout, follow_redirects=True)
        if resp.status_code == 200:
            data = resp.json()
            print(f"✅ AA API 成功，共 {len(data)} 条模型记录")
            return {m.get("slug", ""): m for m in data if isinstance(m, dict)}
        else:
            print(f"⚠️  AA API 返回 {resp.status_code}，降级到固定快照")
            return {}
    except Exception as e:
        print(f"⚠️  AA API 请求失败（{type(e).__name__}: {e}），降级到固定快照")
        return {}


def try_fetch_aa_html_intelligence() -> dict[str, int]:
    """
    备用方案：从榜单页 HTML 中提取 Intelligence Index（正则解析）。
    返回 {slug: intelligence_score}。
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; Mozilla/5.0 Chrome/120.0.0.0)"
    }
    result: dict[str, int] = {}
    try:
        resp = httpx.get(AA_LEADERBOARD_URL, headers=headers, timeout=20, follow_redirects=True)
        if resp.status_code != 200:
            return result
        # 从 JSON 嵌入的 __NEXT_DATA__ 提取数据
        match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.+?)</script>', resp.text, re.DOTALL)
        if match:
            try:
                next_data = json.loads(match.group(1))
                models = (
                    next_data.get("props", {})
                    .get("pageProps", {})
                    .get("models", [])
                )
                for m in models:
                    slug = m.get("slug") or m.get("id", "")
                    score = m.get("intelligenceIndex") or m.get("intelligence_index")
                    if slug and score is not None:
                        result[slug] = int(score)
                print(f"✅ 从 __NEXT_DATA__ 提取 {len(result)} 条 Intelligence 分数")
            except Exception:
                pass
    except Exception:
        pass
    return result


def build_snapshot(aa_api: dict, aa_html: dict) -> dict:
    """
    合并 AA 数据源 + PINNED_MODELS 固定配置，构建最终快照。
    如果 AA API / HTML 都无法获取，则使用 _fallback 内置数据。
    """
    now_utc = datetime.now(timezone.utc)
    updated_at = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    updated_at_cn = now_utc.strftime("%Y年%-m月%-d日 %H:%M UTC")

    presets = []
    for pinned in PINNED_MODELS:
        slug = pinned["slug"]
        aa_record = aa_api.get(slug, {})
        fallback = pinned.get("_fallback", {})

        # 从 AA 数据提取各字段，失败则用 _fallback 兜底
        def _get(aa_keys, fb_key, default=None):
            for k in aa_keys:
                v = aa_record.get(k)
                if v is not None:
                    return v
            # 从 aa_html 尝试
            if "intelligence" in fb_key:
                v = aa_html.get(slug)
                if v is not None:
                    return v
            return fallback.get(fb_key, default)

        intelligence    = _get(["intelligence_index", "intelligenceIndex"], "intelligence")
        speed           = _get(["output_speed", "outputSpeed"], "speedTps")
        price_input     = _get(["price_per_million_input_tokens", "pricePerMillionInputTokens"], "priceInput")
        price_output    = _get(["price_per_million_output_tokens", "pricePerMillionOutputTokens"], "priceOutput")
        context_window  = _get(["context_window", "contextWindow"], "contextWindow")
        knowledge_cutoff= _get(["knowledge_cutoff", "knowledgeCutoff", "knowledge_cutoff_date"], "knowledgeCutoff")
        supports_image  = bool(_get(["supports_image_input", "supportsImageInput"], "supportsImage", False))
        supports_video  = bool(_get(["supports_video_input", "supportsVideoInput"], "supportsVideo", False))
        supports_audio  = bool(_get(["supports_speech_input", "supportsSpeechInput"], "supportsAudio", False))

        # 构建 desc 文本
        desc_parts = []
        if intelligence is not None:
            desc_parts.append(f"AA Intelligence {intelligence}")
        if speed:
            desc_parts.append(f"{speed:.0f} t/s")
        if price_input is not None:
            desc_parts.append(f"${price_input:.2f}/M 输入")
        if context_window:
            k = context_window // 1000
            desc_parts.append(f"{k}k 上下文" if k < 1000 else "1M 上下文")

        modality_parts = []
        if supports_image: modality_parts.append("图")
        if supports_video: modality_parts.append("视频")
        if supports_audio: modality_parts.append("音频")
        if modality_parts:
            desc_parts.append("支持 " + "/".join(modality_parts))

        desc = "，".join(desc_parts) if desc_parts else ""
        rank = f"AA Intelligence {intelligence}" if intelligence is not None else fallback.get("rank", "")

        preset = {
            "label":      pinned["label"],
            "icon":       pinned["icon"],
            "tag":        pinned["tag"],
            "desc":       desc,
            "rank":       rank or "",
            "recommend":  pinned["recommend"],
            "apiKeyUrl":  pinned["apiKeyUrl"],
            "intelligence":    intelligence,
            "speedTps":        round(float(speed), 1) if speed else None,
            "priceInput":      round(float(price_input), 4) if price_input is not None else None,
            "priceOutput":     round(float(price_output), 4) if price_output is not None else None,
            "contextWindow":   context_window,
            "knowledgeCutoff": knowledge_cutoff,
            "supportsImage":   supports_image,
            "supportsVideo":   supports_video,
            "supportsAudio":   supports_audio,
            "config": {
                "baseUrl":     pinned["baseUrl"],
                "visionModel": pinned["visionModel"],
                "textModel":   pinned["textModel"],
                "videoMode":   pinned["videoMode"],
            },
        }
        presets.append(preset)

    # 用 AA API 是否有效标注数据来源
    data_from_api = bool(aa_api)
    data_from_html = bool(aa_html)
    data_source_note = (
        "AA API (live)" if data_from_api else
        "AA HTML parse (partial)" if data_from_html else
        "fallback (built-in, last known values)"
    )

    snapshot = {
        "updatedAt":    updated_at,
        "updatedAtCn":  updated_at_cn,
        "source":       "Artificial Analysis (https://artificialanalysis.ai/leaderboards/models)",
        "dataSource":   data_source_note,
        "fetchedBy":    "fetch_aa_models.py",
        "presets":      presets,
    }
    return snapshot


def main():
    parser = argparse.ArgumentParser(description="抓取 Artificial Analysis 榜单，生成模型快照")
    parser.add_argument("--dry-run", action="store_true", help="仅打印，不写文件")
    parser.add_argument("--output", default=str(DEFAULT_SNAPSHOT_PATH), help="输出 JSON 路径")
    args = parser.parse_args()

    print("=" * 60)
    print("🔄  开始抓取 Artificial Analysis 榜单数据...")
    print(f"    时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # Step 1：尝试 AA JSON API
    aa_api = fetch_aa_data()

    # Step 2：如果 API 没拿到数据，尝试 HTML 解析
    aa_html: dict[str, int] = {}
    if not aa_api:
        print("🔍  尝试从榜单 HTML 提取 Intelligence 分数...")
        aa_html = try_fetch_aa_html_intelligence()

    # Step 3：合并构建快照
    snapshot = build_snapshot(aa_api, aa_html)

    # Step 4：输出
    output_json = json.dumps(snapshot, ensure_ascii=False, indent=2)

    if args.dry_run:
        print("\n📄  [dry-run] 生成快照（不写文件）：")
        print(output_json[:2000])
        print(f"\n  共 {len(snapshot['presets'])} 个预设，updatedAt={snapshot['updatedAt']}")
    else:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output_json, encoding="utf-8")
        print(f"\n✅  快照已写入: {out_path}")
        print(f"    updatedAt: {snapshot['updatedAt']}")
        print(f"    中文时间:  {snapshot['updatedAtCn']}")
        print(f"    共 {len(snapshot['presets'])} 个预设")

    print("=" * 60)
    return snapshot


if __name__ == "__main__":
    main()
