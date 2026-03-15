// 全局类型定义

export type FileStatus = "pending" | "uploading" | "processing" | "done" | "error";
export type FileType = "image" | "audio" | "video" | "text";

export interface LabelFile {
  id: string;
  localId: string;
  name: string;
  fileHash?: string;       // #11 去重用的 hash
  previewUrl: string;
  fileType: FileType;
  status: FileStatus;
  uploadProgress?: number; // #1 上传进度 0-100
  result?: string;
  transcript?: string;
  resultId?: string;
  inputTokens?: number;
  outputTokens?: number;
  errorMsg?: string;
  truncated?: boolean;     // #8 文本截断标记
  originalChars?: number;  // #8 原始字符数
  _file?: File;
}

export interface Rule {
  id: string;
  session_id: string;
  name: string;
  content: { prompt: string };
  is_active: boolean;
  created_at: string;
}

export interface TokenDay {
  day: string;
  total_input: number;
  total_output: number;
}

export interface TokenByModel {
  model: string;
  input: number;
  output: number;
  total: number;
}

export const STATUS_STYLE: Record<FileStatus, string> = {
  pending:    "bg-zinc-700 text-zinc-300",
  uploading:  "bg-blue-900 text-blue-300",
  processing: "bg-yellow-900 text-yellow-300",
  done:       "bg-green-900 text-green-300",
  error:      "bg-red-900 text-red-300",
};

export const STATUS_LABEL: Record<FileStatus, string> = {
  pending:    "等待中",
  uploading:  "上传中",
  processing: "打标中",
  done:       "完成",
  error:      "出错",
};

export const FILE_TYPE_ICON: Record<FileType, string> = {
  image: "🖼️",
  audio: "🎵",
  video: "🎬",
  text:  "📄",
};

export const FILE_TYPE_LABEL: Record<FileType, string> = {
  image: "图片",
  audio: "音频",
  video: "视频",
  text:  "文本",
};

/** 根据 MIME type 判断文件类型 */
export function detectFileType(file: File): FileType {
  const mime = file.type;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/") || mime === "application/json" ||
      mime === "application/xml" || mime === "application/javascript" ||
      mime.includes("csv") || mime.includes("markdown")) return "text";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg","jpeg","png","gif","webp","bmp","svg"].includes(ext)) return "image";
  if (["mp3","wav","ogg","m4a","flac","aac","wma"].includes(ext)) return "audio";
  if (["mp4","mov","avi","mkv","webm","flv","wmv"].includes(ext)) return "video";
  if (["txt","md","csv","json","xml","log","html","css","js","ts","py"].includes(ext)) return "text";
  return "text";
}

/** #11 计算文件 hash（取前 512KB，速度快） */
export async function calcFileHash(file: File): Promise<string> {
  const slice = file.slice(0, 512 * 1024);
  const buf   = await slice.arrayBuffer();
  const hash  = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
