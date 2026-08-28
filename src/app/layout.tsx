import type { Metadata } from 'next';
import { Noto_Serif_SC, Inter } from 'next/font/google';
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
 *
 * 字体(编辑部纸感): 标题用思源宋体, 拉丁字母与数字用 Inter。分数、时长、字数
 * 在这个工具里到处都是, 系统默认字体的数字宽度不一致, 打字时会跳 —— Inter 的
 * tabular-nums 解决这个。两者都通过 next/font 自托管, 不走外部 CDN。
 */

const serif = Noto_Serif_SC({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-serif-cn',
  display: 'swap',
});

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans-latin',
  display: 'swap',
});
export const metadata: Metadata = {
  title: APP_NAME,
  description: '自媒体智能管理平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className={`${serif.variable} ${sans.variable}`}>
      <body className="flex h-screen overflow-hidden">
        <Sidebar />
        {children}
      </body>
    </html>
  );
}
