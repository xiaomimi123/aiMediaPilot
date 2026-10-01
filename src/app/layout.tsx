import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppNav } from '@/components/app-nav';

export const metadata: Metadata = {
  title: 'MediaPilot',
  description: '项目 + 编导 agent 的口播出片工作台',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="flex h-[100dvh] overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        <AppNav />
        {/* 手机上底部标签栏是 fixed: main 底部留出同样高度, 内容不被挡 */}
        <main className="min-w-0 flex-1 overflow-hidden pb-[var(--tabbar-h)] md:pb-0">{children}</main>
      </body>
    </html>
  );
}
