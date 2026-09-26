import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'MediaPilot',
  description: '项目 + 编导 agent 的口播出片工作台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="flex h-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
          <div className="px-2 py-2 text-sm font-semibold">MediaPilot</div>
          <Link href="/" className="rounded-md px-2 py-1.5 text-sm hover:bg-[var(--bg-surface-hover)]">
            项目
          </Link>
        </nav>
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </body>
    </html>
  );
}
