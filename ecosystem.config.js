/**
 * PM2 进程配置 — 生产/本地部署
 *
 * 使用方式：
 *   pm2 start ecosystem.config.js
 *
 * 注意：此文件使用相对路径，__dirname 指向项目根目录，
 * 确保在 ai-labeler/ 根目录下执行 pm2 命令。
 */

const path = require("path");
const ROOT = __dirname; // ai-labeler/ 根目录

module.exports = {
  apps: [
    {
      // ── FastAPI AI Worker ──────────────────────────────
      name: "ai-worker",
      script: path.join(ROOT, "ai-worker/.venv/bin/uvicorn"),
      args: "main:app --port 8000 --host 127.0.0.1",
      cwd: path.join(ROOT, "ai-worker"),
      interpreter: "none",

      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 2000,

      out_file:  path.join(ROOT, "logs/ai-worker-out.log"),
      error_file: path.join(ROOT, "logs/ai-worker-err.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,

      env: { PYTHONUNBUFFERED: "1" },
    },
    {
      // ── Next.js Frontend ──────────────────────────────
      name: "frontend",
      script: "npm",
      args: "run dev",
      cwd: path.join(ROOT, "frontend"),
      interpreter: "none",

      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 2000,

      out_file:  path.join(ROOT, "logs/frontend-out.log"),
      error_file: path.join(ROOT, "logs/frontend-err.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,

      env: { PORT: "3000", NODE_ENV: "development" },
    },
    {
      // ── AA 模型榜单定时抓取（每周一 03:00 自动更新快照）──
      name: "aa-model-refresh",
      script: path.join(ROOT, "ai-worker/.venv/bin/python"),
      args: "fetch_aa_models.py",
      cwd: path.join(ROOT, "ai-worker"),
      interpreter: "none",

      cron_restart: "0 3 * * 1",
      autorestart: false,
      watch: false,

      out_file:  path.join(ROOT, "logs/aa-refresh-out.log"),
      error_file: path.join(ROOT, "logs/aa-refresh-err.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,

      env: { PYTHONUNBUFFERED: "1" },
    },
  ],
};
