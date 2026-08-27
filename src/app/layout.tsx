import type { Metadata } from 'next';
import { APP_NAME } from '@/lib/constants';
import { Sidebar } from '@/components/layout/sidebar';
import './globals.css';

/**
 * 根布局(前端重建 · 阶段 1)。
 *
 * 旧版这里同时 import 了 globals.css(Tailwind + shadcn 变量)和 cockpit.css
 * (2194 行手写 CSS, 后引入所以永远赢)。两套体系并存是这次重建的根因:
 * cockpit.css 里的 `input, textarea, select { border/background/border-radius }`
 * 这类裸元素规则会直接盖掉每一个 shadcn 组件, 而两套主题机制(dataset.theme
 * 与 .dark 类)还得靠一段防闪脚本手动同步 —— 那段脚本就是冲突留下的疤。
 *
 * 现在只剩 Tailwind 一套。侧栏与页面外壳在阶段 3 重建。
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
