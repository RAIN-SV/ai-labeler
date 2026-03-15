#!/usr/bin/env python3
"""
音视频打标链路调试脚本
直接调用 main.py 中的处理函数，输出完整日志
"""
import asyncio, os, sys, traceback, time, json
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

from openai import OpenAI

# 从环境或命令行读取 API Key
API_KEY = os.getenv("TEST_API_KEY") or (sys.argv[1] if len(sys.argv) > 1 else "")
if not API_KEY:
    print("❌ 请设置 TEST_API_KEY 环境变量或通过命令行参数传入 API Key")
    print("   用法: python test_av_debug.py sk-xxx")
    sys.exit(1)

# ── 测试配置 ─────────────────────────────────────────────────────
# 默认使用硅基流动的 Qwen2.5-VL（因为截图显示用户用的是"硅基 Qwen2.5-VL"）
CONFIGS = [
    {
        "name": "硅基 Qwen2.5-VL (用户当前配置)",
        "base_url": "https://api.siliconflow.cn/v1",
        "vision_model": "Qwen/Qwen2.5-VL-72B-Instruct",
        "text_model": "Qwen/Qwen2.5-72B-Instruct",
        "video_mode": "native",
    },
    {
        "name": "通义千问 VL-Max (frames模式)",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "vision_model": "qwen-vl-max",
        "text_model": "qwen-plus",
        "video_mode": "frames",
    },
    {
        "name": "通义千问 VL-Max (native模式)",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "vision_model": "qwen2.5-vl-72b-instruct",
        "text_model": "qwen-max",
        "video_mode": "native",
    },
]

VIDEO_PATH = "/tmp/test_label_video.mp4"
AUDIO_PATH = "/tmp/test_label_audio.wav"
REAL_VIDEO_PATH = "/tmp/test_video.mp4"   # 真实视频 12MB

PROMPT_VIDEO = "请描述视频内容，包括画面场景、主要对象和动作。"
PROMPT_AUDIO = "请描述音频内容，转录文字并分析情感和主题。"

LOG_LINES = []

def log(msg):
    print(msg)
    LOG_LINES.append(msg)

def hr(char="─", n=60):
    log(char * n)

# ── 导入处理函数 ──────────────────────────────────────────────────
try:
    from main import process_video, process_audio
    log("✅ 成功导入 process_video, process_audio")
except Exception as e:
    log(f"❌ 导入失败: {e}")
    log(traceback.format_exc())
    sys.exit(1)


async def test_video(cfg: dict, video_path: str):
    label = f"[视频/{cfg['name']}]"
    hr()
    log(f"\n🎬 {label}")
    log(f"   文件: {video_path} ({os.path.getsize(video_path)/1024:.1f} KB)")
    log(f"   模型: {cfg['vision_model']} | 模式: {cfg['video_mode']}")
    log(f"   base_url: {cfg['base_url']}")
    
    try:
        llm = OpenAI(api_key=API_KEY, base_url=cfg["base_url"])
        
        with open(video_path, "rb") as f:
            file_bytes = f.read()
        
        t0 = time.time()
        result, transcript, inp, out = await process_video(
            llm,
            cfg["vision_model"],
            cfg["text_model"],
            file_bytes,
            video_path,          # 本地路径
            PROMPT_VIDEO,
            video_mode=cfg["video_mode"],
        )
        elapsed = time.time() - t0
        
        log(f"\n   ⏱  耗时: {elapsed:.1f}s")
        log(f"   📊 Tokens: input={inp}, output={out}")
        log(f"   📝 转录: {transcript[:200] if transcript else '(无)'}")
        log(f"   📋 结果 (前300字):\n{result[:300]}")
        log(f"\n   ✅ {label} 成功")
        return True, result
        
    except Exception as e:
        log(f"\n   ❌ {label} 失败")
        log(f"   错误类型: {type(e).__name__}")
        log(f"   错误信息: {str(e)}")
        log(f"   完整堆栈:\n{traceback.format_exc()}")
        return False, str(e)


async def test_audio(cfg: dict, audio_path: str):
    label = f"[音频/{cfg['name']}]"
    hr()
    log(f"\n🎵 {label}")
    log(f"   文件: {audio_path} ({os.path.getsize(audio_path)/1024:.1f} KB)")
    log(f"   模型(vision): {cfg['vision_model']}")
    log(f"   模型(text): {cfg['text_model']}")
    log(f"   base_url: {cfg['base_url']}")
    
    try:
        llm = OpenAI(api_key=API_KEY, base_url=cfg["base_url"])
        
        with open(audio_path, "rb") as f:
            file_bytes = f.read()
        
        t0 = time.time()
        result, transcript, inp, out = await process_audio(
            llm,
            cfg["text_model"],
            file_bytes,
            audio_path,
            PROMPT_AUDIO,
            vision_model=cfg["vision_model"],
        )
        elapsed = time.time() - t0
        
        log(f"\n   ⏱  耗时: {elapsed:.1f}s")
        log(f"   📊 Tokens: input={inp}, output={out}")
        log(f"   📝 转录: {transcript[:200] if transcript else '(无)'}")
        log(f"   📋 结果 (前300字):\n{result[:300]}")
        log(f"\n   ✅ {label} 成功")
        return True, result
        
    except Exception as e:
        log(f"\n   ❌ {label} 失败")
        log(f"   错误类型: {type(e).__name__}")
        log(f"   错误信息: {str(e)}")
        log(f"   完整堆栈:\n{traceback.format_exc()}")
        return False, str(e)


async def test_http_upload(video_path: str):
    """测试通过 HTTP 接口直接上传文件（模拟前端行为）"""
    import httpx
    hr()
    log(f"\n🌐 [HTTP直传接口测试] /upload-and-process")
    log(f"   文件: {video_path}")
    
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            with open(video_path, "rb") as f:
                data = {
                    "file_type": "video",
                    "prompt": PROMPT_VIDEO,
                    "api_key": API_KEY,
                    "session_id": "debug_test",
                    "base_url": "https://api.siliconflow.cn/v1",
                    "model": "Qwen/Qwen2.5-VL-72B-Instruct",
                    "text_model": "Qwen/Qwen2.5-72B-Instruct",
                    "video_mode": "native",
                }
                files = {"file": (os.path.basename(video_path), f, "video/mp4")}
                log(f"   发送 POST http://localhost:8000/upload-and-process ...")
                resp = await client.post(
                    "http://localhost:8000/upload-and-process",
                    data=data, files=files
                )
        log(f"   HTTP状态码: {resp.status_code}")
        log(f"   响应体: {resp.text[:500]}")
        
        if resp.status_code == 200:
            body = resp.json()
            file_id = body.get("file_id")
            log(f"   ✅ 接受成功, file_id={file_id}")
            
            # 轮询状态
            log(f"   ⏳ 轮询 /status/{file_id} ...")
            async with httpx.AsyncClient(timeout=30.0) as client:
                for attempt in range(20):
                    await asyncio.sleep(5)
                    sr = await client.get(f"http://localhost:8000/status/{file_id}")
                    sdata = sr.json()
                    status = sdata.get("status")
                    log(f"   [{attempt+1}/20] 状态: {status}")
                    if status == "done":
                        log(f"   ✅ 处理完成! 结果:\n{json.dumps(sdata.get('result',{}), ensure_ascii=False, indent=2)[:500]}")
                        return True
                    elif status == "error":
                        log(f"   ❌ 后台处理失败（status=error）")
                        return False
            log("   ⚠️  超时未完成")
            return False
        else:
            log(f"   ❌ HTTP上传失败: {resp.status_code}")
            return False
            
    except Exception as e:
        log(f"   ❌ HTTP测试异常: {type(e).__name__}: {e}")
        log(traceback.format_exc())
        return False


async def main():
    hr("═")
    log("🔬 音视频打标链路完整调试报告")
    log(f"   时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    log(f"   API Key: {API_KEY[:8]}...{API_KEY[-4:]}")
    hr("═")
    
    results = {}
    
    # ── 1. 用第一个配置（硅基 native模式）测试视频 ──
    cfg0 = CONFIGS[0]
    ok, msg = await test_video(cfg0, VIDEO_PATH)
    results["video_native_siliconflow_tiny"] = ok
    
    # ── 2. 用第二个配置（通义 frames模式）测试视频 ──
    cfg1 = CONFIGS[1]
    ok, msg = await test_video(cfg1, VIDEO_PATH)
    results["video_frames_qianwen"] = ok
    
    # ── 3. 测试音频（硅基配置）──
    ok, msg = await test_audio(cfg0, AUDIO_PATH)
    results["audio_siliconflow"] = ok
    
    # ── 4. 测试音频（通义配置）──
    ok, msg = await test_audio(cfg1, AUDIO_PATH)
    results["audio_qianwen"] = ok

    # ── 5. 如果有真实视频，也测试一下 frames 模式 ──
    if os.path.exists(REAL_VIDEO_PATH):
        log(f"\n⚠️  真实视频 {REAL_VIDEO_PATH} ({os.path.getsize(REAL_VIDEO_PATH)/1024/1024:.1f}MB) 较大，跳过直接函数调用，改用HTTP接口测试")
        ok = await test_http_upload(VIDEO_PATH)   # 用小视频测试HTTP接口
        results["http_upload_interface"] = ok
    
    # ── 汇总 ──────────────────────────────────────────────────────
    hr("═")
    log("\n📊 测试汇总:")
    for k, v in results.items():
        status = "✅ PASS" if v else "❌ FAIL"
        log(f"   {status}  {k}")
    
    pass_count = sum(1 for v in results.values() if v)
    log(f"\n   共 {len(results)} 项, 通过 {pass_count} 项, 失败 {len(results)-pass_count} 项")
    hr("═")
    
    # 写日志文件
    log_path = "/tmp/av_debug_report.txt"
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("\n".join(LOG_LINES))
    log(f"\n📄 完整日志已保存到: {log_path}")


if __name__ == "__main__":
    asyncio.run(main())
