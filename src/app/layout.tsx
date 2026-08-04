import type { Metadata } from 'next';
import { MainLayout } from '@/components/layout/main-layout';
import { APP_NAME } from '@/lib/constants';
import './globals.css';
import './cockpit.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: '自媒体智能管理平台',
};

// 主题防闪 (FOUC) 脚本: 在任何 React 代码 hydrate 之前、首次绘制之前跑, 把上次
// 保存在 localStorage 的主题/风格直接盖到 <html> 上。cockpit 页面 (Cockpit.tsx) 与
// 站外落地页外壳 (ExternalShell) 都只在 mount 后才读同一份 localStorage — 中间那一
// 帧只能先用默认浅色渲染, 深色用户每次刷新都会先闪一下浅色再跳回深色。
// 这段脚本读同样的两个 key (creator-cockpit-theme / creator-cockpit-style),
// 在 hydrate 前就把 dataset.theme / dataset.style / .dark 都定下来, 两个消费方
// (Cockpit.tsx 的 dataset.theme 初始读取、ExternalShell) 拿到的就已经是正确值,
// 不需要再各自补一次 post-hydration effect。
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('creator-cockpit-theme');var s=localStorage.getItem('creator-cockpit-style');var d=document.documentElement;if(t==='dark'||t==='light'){d.dataset.theme=t;d.classList.toggle('dark',t==='dark');d.style.colorScheme=t;}if(s){d.dataset.style=s;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <MainLayout>{children}</MainLayout>
      </body>
    </html>
  );
}
