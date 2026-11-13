import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { AppNav } from '@/components/app-nav';

const latin = localFont({
  src: [
    { path: '../../pipeline/fonts/Inter-400.woff2', weight: '400', style: 'normal' },
    { path: '../../pipeline/fonts/Inter-700.woff2', weight: '700', style: 'normal' },
    { path: '../../pipeline/fonts/Inter-900.woff2', weight: '900', style: 'normal' },
  ],
  variable: '--font-latin',
  display: 'swap',
});

const cjk = localFont({
  src: [
    { path: '../../pipeline/fonts/NotoSansSC-400.woff2', weight: '400', style: 'normal' },
    { path: '../../pipeline/fonts/NotoSansSC-700.woff2', weight: '700', style: 'normal' },
    { path: '../../pipeline/fonts/NotoSansSC-900.woff2', weight: '900', style: 'normal' },
  ],
  variable: '--font-cjk',
  display: 'swap',
  adjustFontFallback: false,
});

const mono = localFont({
  src: [
    { path: '../../pipeline/fonts/JetBrainsMono-400.woff2', weight: '400', style: 'normal' },
    { path: '../../pipeline/fonts/JetBrainsMono-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-mono-face',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MediaPilot',
  description: '项目 + 编导 agent 的口播出片工作台',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${latin.variable} ${cjk.variable} ${mono.variable}`}>
      <body className="flex h-[100dvh] overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        <AppNav />
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </body>
    </html>
  );
}
