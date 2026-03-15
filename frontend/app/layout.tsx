import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 智能打标",
  description: "多模态 AI 智能标注平台 — 图片 · 音频 · 视频 · 文本",
};

export const viewport: Viewport = {
  themeColor: "#FAFAFA",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased" style={{ overflow: "hidden", height: "100vh" }}>
        {children}
      </body>
    </html>
  );
}
