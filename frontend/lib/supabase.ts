// Supabase 客户端 & 常量

import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// #12 API_BASE 优先读环境变量，方便部署到服务器时修改
export const API_BASE =
  (typeof window !== "undefined" && (window as typeof window & { __API_BASE__?: string }).__API_BASE__) ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://localhost:8000";

// #4 APP_TOKEN 访问令牌（留空则不启用）
export const APP_TOKEN = process.env.NEXT_PUBLIC_APP_TOKEN || "";

/** 带 Bearer Token 的 fetch 封装 */
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> || {}),
  };
  if (APP_TOKEN) {
    headers["Authorization"] = `Bearer ${APP_TOKEN}`;
  }
  return fetch(url, { ...init, headers });
}
