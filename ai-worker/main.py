"""
多模态 AI 打标系统 - FastAPI Worker v3.0
优化：#2 音频转录降级 / #3 视频格式友好提示 / #4 简单 token 认证
      #8 文本截断回传 / #10 启动时清理孤立临时文件 / #7 Token 分组统计
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Form, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI
from typing import Optional
import httpx, base64, os, io, json, traceback, tempfile, time, uuid, glob
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

app = FastAPI(title="AI Labeling Worker", version="3.0.0")

# ─── CORS（#12 支持多 origin） ────────────────────────────────
_ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

supabase: Client = create_client(
    os.getenv("SUPABASE_URL", ""),
    os.getenv("SUPABASE_SERVICE_KEY", "")
)

# ─── #4 简单 Bearer Token 认证（可选，不设则跳过） ────────────
_APP_TOKEN = os.getenv("APP_TOKEN", "")   # 留空则不启用认证

def _verify_token(authorization: Optional[str] = Header(default=None)):
    if not _APP_TOKEN:
        return   # 未配置 APP_TOKEN，跳过认证
    if authorization != f"Bearer {_APP_TOKEN}":
        raise HTTPException(status_code=401, detail="无效的访问令牌，请检查 API Token")

# ─── #10 启动时清理孤立临时文件 ──────────────────────────────
@app.on_event("startup")
async def cleanup_stale_tmp():
    stale = glob.glob("/tmp/ailabel_*")
    for f in stale:
        try:
            os.unlink(f)
            print(f"[startup] 清理孤立临时文件: {f}")
        except Exception:
            pass


# ─── 请求模型 ─────────────────────────────────────────────────
class ProcessRequest(BaseModel):
    file_id: str
    file_url: str
    file_type: str = "image"
    prompt: str
    api_key: str
    session_id: str = ""
    base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model: str = "qwen-vl-plus"
    text_model: str = "qwen-plus"
    video_mode: str = "frames"   # "frames"=提帧模式(兼容) | "native"=原生视频URL模式

class TestKeyRequest(BaseModel):
    api_key: str
    base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model: str = "qwen-vl-plus"

class RuleCreate(BaseModel):
    session_id: str
    name: str
    content: dict

class RuleUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[dict] = None
    is_active: Optional[bool] = None

class ResultUpdate(BaseModel):
    result: dict


# ─── 工具函数 ─────────────────────────────────────────────────
def _save_tokens(session_id: str, model: str, input_tokens: int, output_tokens: int, file_type: str = "image"):
    try:
        supabase.table("token_usage").insert({
            "session_id": session_id,
            "model_name": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost": 0,
            "file_type": file_type,
        }).execute()
    except Exception:
        # 若 token_usage 表暂无 file_type 列，降级插入（不带该字段）
        try:
            supabase.table("token_usage").insert({
                "session_id": session_id,
                "model_name": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost": 0,
            }).execute()
        except Exception:
            pass


def _call_llm(llm: OpenAI, model: str, messages: list) -> tuple[str, int, int]:
    response = llm.chat.completions.create(model=model, messages=messages)
    text = response.choices[0].message.content or ""
    usage = response.usage
    return text, (usage.prompt_tokens if usage else 0), (usage.completion_tokens if usage else 0)


async def _download(url: str, timeout: float = 60.0) -> bytes:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"无法下载文件 HTTP {resp.status_code}")
        return resp.content


# ─── 图片处理器 ───────────────────────────────────────────────
async def process_image(llm: OpenAI, model: str, file_bytes: bytes,
                        content_type: str, prompt: str) -> tuple[str, int, int]:
    img_b64 = base64.b64encode(file_bytes).decode()
    if "png" in content_type:    mime = "image/png"
    elif "webp" in content_type: mime = "image/webp"
    elif "gif" in content_type:  mime = "image/gif"
    else:                         mime = "image/jpeg"
    messages = [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}},
        {"type": "text", "text": prompt},
    ]}]
    return _call_llm(llm, model, messages)


# ─── 文本处理器（#8 截断回传元数据） ──────────────────────────
TEXT_LIMIT = int(os.getenv("TEXT_CHAR_LIMIT", "6000"))

async def process_text(llm: OpenAI, model: str, file_bytes: bytes,
                       prompt: str) -> tuple[str, int, int, bool, int]:
    """返回 (result_text, input_tokens, output_tokens, was_truncated, original_len)"""
    try:
        text_content = file_bytes.decode("utf-8", errors="ignore")
    except Exception:
        text_content = file_bytes.decode("latin-1", errors="ignore")

    original_len = len(text_content)
    was_truncated = original_len > TEXT_LIMIT
    if was_truncated:
        text_content = text_content[:TEXT_LIMIT] + "\n\n[...内容已截断，仅分析前 {TEXT_LIMIT} 字符...]"

    messages = [{"role": "user", "content": f"{prompt}\n\n---以下是文本内容---\n\n{text_content}"}]
    result_text, inp, out = _call_llm(llm, model, messages)
    return result_text, inp, out, was_truncated, original_len


# ─── 音频处理器（支持直接传 base64 给 omni 模型，降级到 Paraformer 转录） ──────
async def process_audio(llm: OpenAI, text_model: str, file_bytes: bytes,
                        file_url: str, prompt: str,
                        vision_model: str = "") -> tuple[str, str, int, int]:
    ext = file_url.split("?")[0].split(".")[-1].lower()
    if ext not in ["mp3", "wav", "m4a", "ogg", "flac", "webm"]:
        ext = "mp3"

    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    transcript = ""
    total_in, total_out = 0, 0

    # 先判断是否为支持音频输入的多模态模型（omni系列）
    is_omni_model = "omni" in (vision_model or text_model).lower()

    try:
        # ── 方式1：直接把音频 base64 传给支持音频输入的模型（如 qwen-omni-turbo）
        if is_omni_model:
            try:
                audio_b64 = base64.b64encode(file_bytes).decode()
                mime_map = {"mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4",
                            "ogg": "audio/ogg", "flac": "audio/flac", "webm": "audio/webm"}
                mime = mime_map.get(ext, "audio/mpeg")
                messages = [{"role": "user", "content": [
                    {"type": "input_audio", "input_audio": {
                        "data": audio_b64, "format": ext
                    }},
                    {"type": "text", "text": prompt},
                ]}]
                model_to_use = vision_model if vision_model and "omni" in vision_model.lower() else text_model
                result_text, inp, out = _call_llm(llm, model_to_use, messages)
                total_in += inp; total_out += out
                return result_text, "[直接音频模型分析]", total_in, total_out
            except Exception as omni_err:
                print(f"Omni直接音频失败，降级到Paraformer: {omni_err}")

        # ── 方式2：Paraformer 语音转录 + 文本模型打标
        try:
            with open(tmp_path, "rb") as audio_file:
                transcription = llm.audio.transcriptions.create(
                    model="paraformer-realtime-v2",
                    file=audio_file,
                )
            transcript = transcription.text
        except Exception as transcribe_err:
            # 降级：转录 API 不可用，构造说明文本
            transcript = f"[转录不可用: {type(transcribe_err).__name__}: {str(transcribe_err)[:120]}]"
            fallback_prompt = (
                f"{prompt}\n\n"
                "注意：本次音频转录服务不可用，无法获取文字内容。\n"
                "请根据以上打标规则，生成一份说明转录失败的标注，"
                "并建议用户使用支持音频输入的模型（如 qwen-omni-turbo）或检查 Paraformer API 权限。"
            )
            messages = [{"role": "user", "content": fallback_prompt}]
            result_text, inp, out = _call_llm(llm, text_model, messages)
            total_in += inp; total_out += out
            return result_text, transcript, total_in, total_out

        # 转录成功 → 正常打标
        messages = [{"role": "user", "content": f"{prompt}\n\n---音频转录内容---\n{transcript}"}]
        result_text, inp, out = _call_llm(llm, text_model, messages)
        total_in += inp; total_out += out

    except Exception as e:
        err_str = str(e)
        transcript = f"[处理异常: {err_str}]"
        if "insufficient" in err_str.lower() or "balance" in err_str.lower() or "30001" in err_str:
            result_text = f"音频处理失败：API 账户余额不足\n\n错误详情：{err_str}\n\n💡 解决方案：请登录对应平台充值后重试。"
        elif "401" in err_str or "invalid" in err_str.lower() or "unauthorized" in err_str.lower():
            result_text = f"音频处理失败：API Key 无效或未授权\n\n错误详情：{err_str}\n\n💡 解决方案：请检查并重新填写正确的 API Key。"
        elif "429" in err_str or "rate" in err_str.lower():
            result_text = f"音频处理失败：API 请求频率超限，请稍等后重试。\n\n错误详情：{err_str}"
        else:
            result_text = f"音频处理失败：{err_str}"
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    return result_text, transcript, total_in, total_out


# ─── 视频处理器（#3 格式不兼容友好提示） ──────────────────────
async def process_video(llm: OpenAI, vision_model: str, text_model: str,
                        file_bytes: bytes, file_url: str, prompt: str,
                        video_mode: str = "frames") -> tuple[str, str, int, int]:
    """
    video_mode="native"  → 直接把视频 URL 传给支持原生视频的模型（Qwen2.5-VL / Gemini 等）
                           同时用 PyAV 分离音轨 → Paraformer 转录，一次拿到画面+声音
    video_mode="frames"  → 原来的提帧逻辑（兼容不支持视频 URL 的模型）
    """
    import av
    from PIL import Image

    ext = file_url.split("?")[0].split(".")[-1].lower()
    if ext not in ["mp4", "mov", "avi", "mkv", "webm", "flv"]:
        ext = "mp4"

    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    total_in, total_out = 0, 0
    transcript = ""

    try:
        # ══════════════════════════════════════════════════════════
        # 原生视频模式：直接传视频 URL + 同步提取音轨转录
        # 适用模型：Qwen2.5-VL、Gemini 1.5/2.0、GPT-4o（部分支持）
        # ══════════════════════════════════════════════════════════
        if video_mode == "native":
            # Step 1: 尝试提取音轨并转录
            audio_tmp = None
            try:
                container = av.open(tmp_path)
                audio_stream = next((s for s in container.streams if s.type == "audio"), None)
                if audio_stream:
                    audio_tmp = tmp_path.replace(f".{ext}", "_audio.mp3")
                    output = av.open(audio_tmp, mode="w")
                    out_stream = output.add_stream("mp3")
                    for packet in container.demux(audio_stream):
                        for frame in packet.decode():
                            for pkt in out_stream.encode(frame):
                                output.mux(pkt)
                    for pkt in out_stream.encode(None):
                        output.mux(pkt)
                    output.close()
                    container.close()

                    with open(audio_tmp, "rb") as af:
                        audio_bytes = af.read()
                    # 复用 process_audio 音频转录
                    _, transcript, a_in, a_out = await process_audio(
                        llm, text_model, audio_bytes, audio_tmp, "请转录音频内容",
                        vision_model=vision_model
                    )
                    total_in += a_in; total_out += a_out
                else:
                    container.close()
            except Exception as audio_err:
                transcript = f"[音轨提取失败: {type(audio_err).__name__}]"
            finally:
                if audio_tmp and os.path.exists(audio_tmp):
                    os.unlink(audio_tmp)

            # Step 2: 直接传视频给原生视频模型
            # 检测是否为 Gemini 模型（需要用 Files API 上传）
            is_gemini = ("gemini" in vision_model.lower() or
                         "generativelanguage.googleapis.com" in str(getattr(llm, "_base_url", "")))

            combined_prompt = prompt
            if transcript and not transcript.startswith("["):
                combined_prompt += f"\n\n---视频音频转录---\n{transcript}"

            if is_gemini:
                # Gemini 原生视频：通过 Gemini Files API 上传，获取 file_uri 引用
                import google.generativeai as genai
                # 从 OpenAI client 提取 api_key
                gemini_api_key = llm.api_key
                genai.configure(api_key=gemini_api_key)
                try:
                    video_file = genai.upload_file(
                        path=tmp_path,
                        mime_type=f"video/{ext}",
                        display_name=f"video_{ext}",
                    )
                    # 等待文件处理完成（最多 60 秒）
                    import time as _time
                    for _ in range(30):
                        video_file = genai.get_file(video_file.name)
                        if video_file.state.name == "ACTIVE":
                            break
                        _time.sleep(2)

                    model_obj = genai.GenerativeModel(vision_model)
                    response = model_obj.generate_content([
                        video_file,
                        combined_prompt,
                    ])
                    result_text = response.text or ""
                    # Gemini SDK 不直接给 token 数，尝试读取
                    try:
                        usage = response.usage_metadata
                        inp_g = usage.prompt_token_count or 0
                        out_g = usage.candidates_token_count or 0
                    except Exception:
                        inp_g, out_g = 0, 0
                    total_in += inp_g; total_out += out_g

                    # 清理上传的文件
                    try:
                        genai.delete_file(video_file.name)
                    except Exception:
                        pass

                    return result_text, transcript, total_in, total_out
                except Exception as gemini_err:
                    # Gemini Files API 失败，回退到 OpenAI 兼容接口+base64（小文件）
                    print(f"[Gemini Files API] 失败，回退 base64: {gemini_err}")
                    b64 = base64.b64encode(file_bytes).decode()
                    video_content = {
                        "type": "image_url",
                        "image_url": {"url": f"data:video/{ext};base64,{b64}"}
                    }
            else:
                # 非 Gemini：用 OpenAI 兼容接口的 video_url 格式
                if file_url.startswith("http"):
                    video_content = {"type": "video_url", "video_url": {"url": file_url}}
                else:
                    b64 = base64.b64encode(file_bytes).decode()
                    video_content = {
                        "type": "video_url",
                        "video_url": {"url": f"data:video/{ext};base64,{b64}"}
                    }

            msgs = [{"role": "user", "content": [
                video_content,
                {"type": "text", "text": combined_prompt},
            ]}]
            result_text, inp, out = _call_llm(llm, vision_model, msgs)
            total_in += inp; total_out += out
            return result_text, transcript, total_in, total_out

        # ══════════════════════════════════════════════════════════
        # 提帧模式（原逻辑，兼容旧模型）
        # ══════════════════════════════════════════════════════════
        try:
            container = av.open(tmp_path)
        except Exception as open_err:
            # #3 格式不兼容友好提示
            friendly = (
                f"视频文件无法解码（格式可能不受支持）。\n"
                f"错误详情：{str(open_err)}\n\n"
                f"建议：\n"
                f"• 请将视频转换为 MP4（H.264 编码）后重试\n"
                f"• 推荐使用工具：HandBrake、FFmpeg 或在线转换网站\n"
                f"• 支持格式：MP4 / MOV / AVI / MKV / WebM / FLV"
            )
            return friendly, "", 0, 0

        video_stream = next((s for s in container.streams if s.type == "video"), None)
        if not video_stream:
            container.close()
            return "视频文件中未找到视频流，请确认文件完整且包含视频轨道。", "", 0, 0

        frames_b64 = []
        try:
            duration = float(video_stream.duration or 0) * video_stream.time_base
            if duration <= 0:
                duration = 30.0
            N_FRAMES = min(6, max(2, int(duration / 5)))
            frame_times = [duration * i / N_FRAMES for i in range(N_FRAMES)]

            container.seek(0)
            frame_pts_set = set()
            for frame in container.decode(video=0):
                t = float(frame.pts * video_stream.time_base)
                for ft in frame_times:
                    if abs(t - ft) < 0.5 and ft not in frame_pts_set:
                        frame_pts_set.add(ft)
                        img = frame.to_image()
                        img.thumbnail((800, 800))
                        buf = io.BytesIO()
                        img.save(buf, format="JPEG", quality=80)
                        frames_b64.append(base64.b64encode(buf.getvalue()).decode())
                if len(frames_b64) >= N_FRAMES:
                    break
        except Exception as decode_err:
            container.close()
            return (
                f"视频帧提取失败，编码格式可能不兼容。\n"
                f"错误：{str(decode_err)}\n\n"
                f"建议将视频转为 H.264 编码的 MP4 格式后重试。",
                "", 0, 0
            )

        container.close()

        if not frames_b64:
            return "未能从视频中提取到任何帧，视频可能损坏或时长为 0。", "", 0, 0

        # ── 逐帧视觉描述 ──────────────────────────────────────
        frame_descriptions = []
        for i, fb64 in enumerate(frames_b64):
            msgs = [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{fb64}"}},
                {"type": "text", "text": f"这是视频第 {i+1}/{len(frames_b64)} 帧，请简要描述画面内容（2-3句话）。"},
            ]}]
            desc, inp, out = _call_llm(llm, vision_model, msgs)
            frame_descriptions.append(f"[帧{i+1}] {desc}")
            total_in += inp; total_out += out

        # ── 综合分析 ──────────────────────────────────────────
        frames_summary = "\n".join(frame_descriptions)
        combined_prompt = f"{prompt}\n\n---视频关键帧描述（共{len(frames_b64)}帧）---\n{frames_summary}"
        if transcript:
            combined_prompt += f"\n\n---音频转录---\n{transcript}"

        result_text, inp, out = _call_llm(llm, text_model, [{"role": "user", "content": combined_prompt}])
        total_in += inp; total_out += out

    except Exception as e:
        err_str = str(e)
        # 根据错误类型给出有针对性的建议，避免误导用户
        if "insufficient" in err_str.lower() or "balance" in err_str.lower() or "30001" in err_str:
            result_text = f"视频处理失败：API 账户余额不足\n\n错误详情：{err_str}\n\n💡 解决方案：请登录对应平台充值后重试。"
        elif "401" in err_str or "invalid" in err_str.lower() or "token" in err_str.lower() or "unauthorized" in err_str.lower():
            result_text = f"视频处理失败：API Key 无效或未授权\n\n错误详情：{err_str}\n\n💡 解决方案：请检查并重新填写正确的 API Key。"
        elif "rate" in err_str.lower() or "429" in err_str or "quota" in err_str.lower():
            result_text = f"视频处理失败：API 请求频率超限\n\n错误详情：{err_str}\n\n💡 解决方案：请稍等片刻后重试，或升级 API 套餐。"
        elif "timeout" in err_str.lower() or "timed out" in err_str.lower():
            result_text = f"视频处理失败：请求超时\n\n错误详情：{err_str}\n\n💡 解决方案：视频文件可能过大，请压缩后重试，或切换到提帧模式。"
        elif "format" in err_str.lower() or "codec" in err_str.lower() or "decode" in err_str.lower():
            result_text = f"视频处理失败：格式不兼容\n\n错误详情：{err_str}\n\n💡 解决方案：请将视频转换为 MP4（H.264 编码）格式后重试。"
        else:
            result_text = f"视频处理异常：{err_str}"
        print(f"视频处理错误: {traceback.format_exc()}")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    return result_text, transcript, total_in, total_out


# ─── 模型预设快照接口 ─────────────────────────────────────────
_SNAPSHOT_PATH = os.path.join(os.path.dirname(__file__), "models_snapshot.json")

@app.get("/model-presets")
async def get_model_presets():
    """
    返回最新的模型预设快照（来自 models_snapshot.json）。
    包含 updatedAt 时间戳，前端可据此显示"数据截止时间"。
    """
    try:
        with open(_SNAPSHOT_PATH, "r", encoding="utf-8") as f:
            snapshot = json.load(f)
        return snapshot
    except FileNotFoundError:
        # 文件不存在时返回空快照，前端降级使用内置 PRESETS
        return {
            "updatedAt": None,
            "updatedAtCn": None,
            "source": "Artificial Analysis",
            "presets": [],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取模型快照失败: {str(e)}")


@app.post("/model-presets/refresh")
async def refresh_model_presets(background_tasks: BackgroundTasks, _=Depends(_verify_token)):
    """
    触发后台重新抓取 Artificial Analysis 榜单，更新快照。
    需要认证（APP_TOKEN）。
    """
    import subprocess as _subprocess, sys as _sys

    def _do_refresh():
        script = os.path.join(os.path.dirname(__file__), "fetch_aa_models.py")
        try:
            result = _subprocess.run(
                [_sys.executable, script],
                capture_output=True, text=True, timeout=60,
                cwd=os.path.dirname(__file__)
            )
            print(f"[model-presets/refresh] stdout: {result.stdout[-500:]}")
            if result.returncode != 0:
                print(f"[model-presets/refresh] stderr: {result.stderr[-300:]}")
        except Exception as ex:
            print(f"[model-presets/refresh] 刷新失败: {ex}")

    background_tasks.add_task(_do_refresh)
    return {"status": "accepted", "message": "正在后台重新抓取 AA 榜单，请稍后刷新页面"}


# ─── 健康检查 ─────────────────────────────────────────────────
@app.get("/health")
async def health_check():
    return {
        "status": "ok", "service": "ai-labeling-worker", "version": "3.0.0",
        "auth_enabled": bool(_APP_TOKEN),
        "text_limit": TEXT_LIMIT,
        "allowed_origins": _ALLOWED_ORIGINS,
    }


# ─── 测试 API Key ─────────────────────────────────────────────
@app.post("/test-key")
async def test_api_key(req: TestKeyRequest, _=Depends(_verify_token)):
    try:
        llm = OpenAI(api_key=req.api_key, base_url=req.base_url)
        llm.chat.completions.create(model=req.model, messages=[{"role":"user","content":"hi"}], max_tokens=5)
        return {"status": "ok", "message": "API Key 验证成功"}
    except Exception as e:
        return {"status": "error", "message": f"验证失败: {str(e)}"}


# ─── 核心处理接口 ─────────────────────────────────────────────
@app.post("/process")
async def process_file(req: ProcessRequest, background_tasks: BackgroundTasks, _=Depends(_verify_token)):
    supabase.table("files_metadata").update({"status": "processing"}).eq("id", req.file_id).execute()
    if req.file_type in ("audio", "video"):
        background_tasks.add_task(_process_async, req)
        return {"status": "accepted", "message": "任务已接受，后台处理中"}
    else:
        return await _process_sync(req)


async def _process_sync(req: ProcessRequest):
    try:
        file_bytes = await _download(req.file_url, timeout=30.0)
        llm = OpenAI(api_key=req.api_key, base_url=req.base_url)

        was_truncated = False
        original_len = 0

        if req.file_type == "image":
            async with httpx.AsyncClient(timeout=10.0) as c:
                head = await c.head(req.file_url)
            ct = head.headers.get("content-type", "image/jpeg")
            result_text, inp, out = await process_image(llm, req.model, file_bytes, ct, req.prompt)
        else:  # text — #8 接收截断元数据
            result_text, inp, out, was_truncated, original_len = await process_text(
                llm, req.text_model, file_bytes, req.prompt
            )

        _write_result(req.file_id, req.model, req.prompt, result_text, "", inp, out)
        _save_tokens(req.session_id, req.model, inp, out, req.file_type)
        supabase.table("files_metadata").update({"status": "done"}).eq("id", req.file_id).execute()

        return {
            "status": "done", "result": result_text,
            "tokens": {"input": inp, "output": out},
            # #8 截断信息透传给前端
            "truncated": was_truncated,
            "original_chars": original_len,
            "text_limit": TEXT_LIMIT,
        }
    except HTTPException:
        raise
    except Exception as e:
        supabase.table("files_metadata").update({"status": "error"}).eq("id", req.file_id).execute()
        print(f"同步处理失败: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"处理失败: {str(e)}")


async def _process_async(req: ProcessRequest):
    try:
        file_bytes = await _download(req.file_url, timeout=120.0)
        llm = OpenAI(api_key=req.api_key, base_url=req.base_url)

        if req.file_type == "audio":
            result_text, transcript, inp, out = await process_audio(
                llm, req.text_model, file_bytes, req.file_url, req.prompt,
                vision_model=req.model   # 传入视觉/多模态模型名，支持 omni 等直接音频识别
            )
        else:
            result_text, transcript, inp, out = await process_video(
                llm, req.model, req.text_model, file_bytes, req.file_url, req.prompt,
                video_mode=req.video_mode
            )

        _write_result(req.file_id, req.model, req.prompt, result_text, transcript, inp, out)
        _save_tokens(req.session_id, req.model, inp, out, req.file_type)
        supabase.table("files_metadata").update({"status": "done"}).eq("id", req.file_id).execute()

    except Exception:
        supabase.table("files_metadata").update({"status": "error"}).eq("id", req.file_id).execute()
        print(f"异步处理失败: {traceback.format_exc()}")


def _write_result(file_id: str, model: str, prompt: str, result: str,
                  transcript: str, inp: int, out: int):
    supabase.table("label_results").insert({
        "file_id": file_id, "model_name": model, "result": {"raw": result},
        "prompt_used": prompt, "transcript": transcript or None,
        "input_tokens": inp, "output_tokens": out,
    }).execute()


# ─── 大文件直传接口 ───────────────────────────────────────────
@app.post("/upload-and-process")
async def upload_and_process(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    file_type: str = Form(...),
    prompt: str = Form(...),
    api_key: str = Form(...),
    session_id: str = Form(""),
    base_url: str = Form("https://dashscope.aliyuncs.com/compatible-mode/v1"),
    model: str = Form("qwen-vl-plus"),
    text_model: str = Form("qwen-plus"),
    video_mode: str = Form("frames"),
    _=Depends(_verify_token),
):
    meta_res = supabase.table("files_metadata").insert({
        "session_id": session_id, "file_name": file.filename or "unknown",
        "file_url": "", "file_type": file_type, "status": "processing",
    }).execute()

    if not meta_res.data:
        raise HTTPException(status_code=500, detail="创建文件记录失败")

    file_id = meta_res.data[0]["id"]
    ext = (file.filename or "bin").rsplit(".", 1)[-1]
    tmp_path = f"/tmp/ailabel_{uuid.uuid4().hex}.{ext}"
    content = await file.read()
    with open(tmp_path, "wb") as f_out:
        f_out.write(content)

    req = ProcessRequest(
        file_id=file_id, file_url=f"file://{tmp_path}", file_type=file_type,
        prompt=prompt, api_key=api_key, session_id=session_id,
        base_url=base_url, model=model, text_model=text_model,
        video_mode=video_mode,
    )
    background_tasks.add_task(_process_local_file, req, tmp_path)
    return {"status": "accepted", "file_id": file_id, "message": "大文件已接收，后台处理中"}


async def _process_local_file(req: ProcessRequest, tmp_path: str):
    """
    处理通过 /upload-and-process 上传的大文件（存于 /tmp）。
    ⚠️ native 视频模式：Qwen/Gemini 需要 https URL，不能用 base64（超 20MB 限制）。
       这里先将 /tmp 文件上传到 Supabase Storage 获取公开 URL，再做 native 处理。
    """
    try:
        with open(tmp_path, "rb") as f:
            file_bytes = f.read()
    except Exception:
        supabase.table("files_metadata").update({"status": "error"}).eq("id", req.file_id).execute()
        return

    # ── native 视频模式：必须有 https URL ───────────────────────
    # 如果 file_url 是 file://，先上传到 Supabase Storage
    effective_url = req.file_url
    storage_cleanup_path: str | None = None
    if (req.file_type == "video" and req.video_mode == "native"
            and req.file_url.startswith("file://")):
        try:
            ext = tmp_path.rsplit(".", 1)[-1]
            storage_path = (
                f"{req.session_id or 'direct'}/video/"
                f"{req.file_id}_{uuid.uuid4().hex[:6]}.{ext}"
            )
            with open(tmp_path, "rb") as fup:
                up_res = supabase.storage.from_("uploads").upload(
                    storage_path, fup,
                    {"content-type": f"video/{ext}", "upsert": "false"}
                )
            # supabase-py v2 返回 dict，不抛异常即为成功
            SUPABASE_URL_BASE = os.environ.get("SUPABASE_URL", "")
            if SUPABASE_URL_BASE:
                effective_url = (
                    f"{SUPABASE_URL_BASE}/storage/v1/object/public/uploads/{storage_path}"
                )
                storage_cleanup_path = storage_path
                print(f"[local→native] 上传成功，URL: {effective_url}")
            else:
                # 没有配置 SUPABASE_URL 则降级提帧
                print("[local→native] SUPABASE_URL 未配置，降级为提帧模式")
                req = req.model_copy(update={"video_mode": "frames"})
        except Exception as up_err:
            # 上传失败：降级为提帧模式，不中断处理
            print(f"[local→native] Supabase 上传失败，降级提帧: {up_err}")
            req = req.model_copy(update={"video_mode": "frames"})

    try:
        llm = OpenAI(api_key=req.api_key, base_url=req.base_url)
        if req.file_type == "audio":
            result_text, transcript, inp, out = await process_audio(
                llm, req.text_model, file_bytes, tmp_path, req.prompt,
                vision_model=req.model
            )
        else:
            result_text, transcript, inp, out = await process_video(
                llm, req.model, req.text_model, file_bytes, effective_url, req.prompt,
                video_mode=req.video_mode
            )
        _write_result(req.file_id, req.model, req.prompt, result_text, transcript, inp, out)
        _save_tokens(req.session_id, req.model, inp, out, req.file_type)
        supabase.table("files_metadata").update({"status": "done"}).eq("id", req.file_id).execute()
    except Exception:
        supabase.table("files_metadata").update({"status": "error"}).eq("id", req.file_id).execute()
        print(f"本地文件处理失败: {traceback.format_exc()}")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        # storage_cleanup_path 暂不主动删除（用于用户查看历史结果）


# ─── 轮询状态 ─────────────────────────────────────────────────
@app.get("/status/{file_id}")
async def get_file_status(file_id: str, _=Depends(_verify_token)):
    res = supabase.table("files_metadata").select("status").eq("id", file_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="文件不存在")
    status = res.data["status"]
    result = None
    if status == "done":
        r = supabase.table("label_results") \
            .select("id,result,transcript,input_tokens,output_tokens") \
            .eq("file_id", file_id).order("created_at", desc=True).limit(1).execute()
        if r.data:
            result = r.data[0]
    return {"status": status, "result": result}


# ─── 规则库 CRUD ──────────────────────────────────────────────
@app.get("/rules")
async def list_rules(session_id: str, _=Depends(_verify_token)):
    res = supabase.table("labeling_rules").select("*").eq("session_id", session_id).order("created_at", desc=True).execute()
    return res.data

@app.post("/rules")
async def create_rule(req: RuleCreate, _=Depends(_verify_token)):
    res = supabase.table("labeling_rules").insert({"session_id": req.session_id, "name": req.name, "content": req.content}).execute()
    return res.data[0] if res.data else {}

@app.put("/rules/{rule_id}")
async def update_rule(rule_id: str, req: RuleUpdate, _=Depends(_verify_token)):
    data = {k: v for k, v in {"name": req.name, "content": req.content, "is_active": req.is_active}.items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="没有要更新的字段")
    res = supabase.table("labeling_rules").update(data).eq("id", rule_id).execute()
    return res.data[0] if res.data else {}

@app.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, _=Depends(_verify_token)):
    supabase.table("labeling_rules").delete().eq("id", rule_id).execute()
    return {"status": "deleted"}


# ─── 修改 / 查询结果 ──────────────────────────────────────────
@app.put("/results/{result_id}")
async def update_result(result_id: str, req: ResultUpdate, _=Depends(_verify_token)):
    res = supabase.table("label_results").update({"result": req.result}).eq("id", result_id).execute()
    return res.data[0] if res.data else {}

@app.get("/results")
async def list_results(session_id: str, _=Depends(_verify_token)):
    res = supabase.table("label_results") \
        .select("*, files_metadata!inner(session_id, file_name, file_url, file_type)") \
        .eq("files_metadata.session_id", session_id).order("created_at", desc=True).execute()
    return res.data


# ─── Token 统计（#7 支持按模型/会话分组） ─────────────────────
@app.get("/token-usage")
async def get_token_usage(days: int = 7, _=Depends(_verify_token)):
    try:
        res = supabase.rpc("get_token_usage_by_day", {"p_days": days}).execute()
        return res.data
    except Exception:
        return []

@app.get("/token-usage/total")
async def get_token_total(session_id: Optional[str] = None, _=Depends(_verify_token)):
    query = supabase.table("token_usage").select("input_tokens, output_tokens, model_name, session_id")
    if session_id:
        query = query.eq("session_id", session_id)
    res = query.execute()
    total_in  = sum(r.get("input_tokens", 0)  for r in res.data)
    total_out = sum(r.get("output_tokens", 0) for r in res.data)
    return {"total_input": total_in, "total_output": total_out, "total": total_in + total_out}

@app.get("/token-usage/by-model")
async def get_token_by_model(days: int = 30, _=Depends(_verify_token)):
    """#7 按模型名分组统计"""
    from datetime import datetime, timedelta
    since = (datetime.utcnow() - timedelta(days=days)).isoformat()
    res = supabase.table("token_usage") \
        .select("model_name, input_tokens, output_tokens") \
        .gte("created_at", since).execute()

    groups: dict = {}
    for r in res.data:
        m = r.get("model_name") or "unknown"
        if m not in groups:
            groups[m] = {"model": m, "input": 0, "output": 0, "total": 0}
        groups[m]["input"]  += r.get("input_tokens", 0)
        groups[m]["output"] += r.get("output_tokens", 0)
        groups[m]["total"]  += r.get("input_tokens", 0) + r.get("output_tokens", 0)

    return sorted(groups.values(), key=lambda x: x["total"], reverse=True)


@app.get("/token-usage/by-filetype")
async def get_token_by_filetype(days: int = 30, _=Depends(_verify_token)):
    """按模态类型分组统计 Token 消耗"""
    from datetime import datetime, timedelta
    since = (datetime.utcnow() - timedelta(days=days)).isoformat()
    try:
        res = supabase.table("token_usage") \
            .select("file_type, input_tokens, output_tokens") \
            .gte("created_at", since).execute()
    except Exception:
        return []

    groups: dict = {}
    for r in res.data:
        ft = r.get("file_type") or "image"
        if ft not in groups:
            groups[ft] = {"file_type": ft, "input": 0, "output": 0, "total": 0}
        groups[ft]["input"]  += r.get("input_tokens", 0)
        groups[ft]["output"] += r.get("output_tokens", 0)
        groups[ft]["total"]  += r.get("input_tokens", 0) + r.get("output_tokens", 0)

    order = ["image", "audio", "video", "text"]
    result = [groups[k] for k in order if k in groups]
    result += [v for k, v in groups.items() if k not in order]
    return result


# ─── 导出中心：历史打标结果（分页+排序） ──────────────────────
@app.get("/export/results")
async def export_results(
    session_id: str = "",
    page: int = 1,
    page_size: int = 50,
    file_type: str = "",          # 过滤模态：image/audio/video/text/""
    keyword: str = "",            # 文件名关键词
    _=Depends(_verify_token),
):
    """
    导出中心：返回按 created_at 倒序排列的打标结果列表（分页）。
    包含文件元信息 + 打标结果 + token 消耗。
    """
    from datetime import datetime, timezone

    # 构建联表查询
    query = (
        supabase.table("label_results")
        .select(
            "id, created_at, result, transcript, input_tokens, output_tokens, "
            "files_metadata!inner(id, file_name, file_url, file_type, session_id)"
        )
        .order("created_at", desc=True)
    )

    # 会话过滤（非空时限制本 session）
    if session_id:
        query = query.eq("files_metadata.session_id", session_id)

    # 模态过滤
    if file_type:
        query = query.eq("files_metadata.file_type", file_type)

    # 分页
    offset = (page - 1) * page_size
    query = query.range(offset, offset + page_size - 1)

    res = query.execute()
    rows = res.data or []

    # 文件名关键词过滤（Supabase 不支持 LIKE on join，前端过滤）
    if keyword:
        kw = keyword.lower()
        rows = [r for r in rows if kw in (r.get("files_metadata", {}) or {}).get("file_name", "").lower()]

    # 统一返回格式
    out = []
    for r in rows:
        meta = r.get("files_metadata") or {}
        raw_result = r.get("result") or {}
        out.append({
            "id":           r.get("id"),
            "createdAt":    r.get("created_at"),
            "fileName":     meta.get("file_name", ""),
            "fileType":     meta.get("file_type", ""),
            "fileUrl":      meta.get("file_url", ""),
            "result":       raw_result.get("raw", "") if isinstance(raw_result, dict) else str(raw_result),
            "transcript":   r.get("transcript") or "",
            "inputTokens":  r.get("input_tokens", 0),
            "outputTokens": r.get("output_tokens", 0),
        })

    return {"items": out, "page": page, "pageSize": page_size, "total": len(rows)}


@app.get("/export/db-stats")
async def export_db_stats(_=Depends(_verify_token)):
    """
    查询数据库行数统计：
    - label_results 总条数
    - files_metadata 总条数
    - token_usage 总条数
    并基于 Supabase 免费层限制推算自动清理建议。
    """
    try:
        count_results = supabase.table("label_results").select("id", count="exact").execute().count or 0
        count_files   = supabase.table("files_metadata").select("id", count="exact").execute().count or 0
        count_tokens  = supabase.table("token_usage").select("id", count="exact").execute().count or 0

        # Supabase Free 层：500MB 数据库，每行约 0.5KB 估算
        SUPABASE_FREE_ROWS = 1_000_000   # 实际约 50 万行安全上限
        ROWS_PER_DAY_EST   = max(count_results, 1)  # 简单用总量/天估算

        # 推算"多少天后可能触达上限"
        total_rows = count_results + count_files + count_tokens
        days_to_limit = max(0, (SUPABASE_FREE_ROWS - total_rows) // max(ROWS_PER_DAY_EST, 1))

        # 推荐自动清理周期：按 80% 用量阈值
        SAFE_LIMIT = int(SUPABASE_FREE_ROWS * 0.8)
        if total_rows > SAFE_LIMIT:
            suggested_delete_days = 30    # 已超阈值，建议保留 30 天内
        elif count_results > 10000:
            suggested_delete_days = 90
        else:
            suggested_delete_days = 180   # 数据少，可保留 180 天

        return {
            "labelResultsCount": count_results,
            "filesMetadataCount": count_files,
            "tokenUsageCount": count_tokens,
            "totalRows": total_rows,
            "freeRowLimit": SUPABASE_FREE_ROWS,
            "usagePercent": round(total_rows / SUPABASE_FREE_ROWS * 100, 2),
            "suggestedDeleteDays": suggested_delete_days,
            "warning": total_rows > SAFE_LIMIT,
        }
    except Exception as e:
        return {"error": str(e), "totalRows": 0, "usagePercent": 0, "suggestedDeleteDays": 90}


@app.delete("/export/cleanup")
async def export_cleanup(keep_days: int = 90, _=Depends(_verify_token)):
    """
    清理 keep_days 天前的历史打标结果（label_results + files_metadata）。
    """
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(days=keep_days)).isoformat()

    # 先查出要删除的 label_results id
    old_results = supabase.table("label_results") \
        .select("id").lt("created_at", cutoff).execute()
    ids = [r["id"] for r in (old_results.data or [])]

    deleted_results = 0
    if ids:
        supabase.table("label_results").delete().in_("id", ids).execute()
        deleted_results = len(ids)

    # 清理对应的 files_metadata（status=done，超期）
    old_files = supabase.table("files_metadata") \
        .select("id").lt("created_at", cutoff).eq("status", "done").execute()
    file_ids = [r["id"] for r in (old_files.data or [])]
    deleted_files = 0
    if file_ids:
        supabase.table("files_metadata").delete().in_("id", file_ids).execute()
        deleted_files = len(file_ids)

    return {
        "status": "ok",
        "deletedResults": deleted_results,
        "deletedFiles": deleted_files,
        "cutoffDate": cutoff,
    }

