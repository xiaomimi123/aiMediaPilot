import type { Metadata } from 'next';
import { APP_NAME } from '@/lib/constants';
import { Sidebar } from '@/components/layout/sidebar';
import './globals.css';

/**
 * 根布局(三十四期 UI 重做)。
 *
 * 字体不再走 next/font/google —— 旧版在这里引 Noto_Serif_SC + Inter, 而这台机器
 * 连不通 Google Fonts: dev server 每次冷启动都刷 48 条
 * `The user aborted a request / Retrying`, 全是字体拉取的重试(2026-09-08 实测)。
 * 新设计中文走系统字体(PingFang SC 必在)、数字走系统等宽栈(SF Mono/ui-monospace),
 * 字体栈定义在 tokens.css 的 --font/--mono, 一个网络请求都没有。
 * 设计交付 README 建议 JetBrains Mono 走 Google Fonts —— 因上述网络原因不采用,
 * 将来要的话下载字体文件走 next/font/local。
 */

export const metadata: Metadata = {
  title: APP_NAME,
  description: '自媒体智能管理平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="flex h-screen overflow-hidden">
        <Sidebar />
        {children}
      </body>
    </html>
  );
}
