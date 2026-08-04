import type { Metadata } from 'next';
import { MainLayout } from '@/components/layout/main-layout';
import { APP_NAME } from '@/lib/constants';
import './globals.css';
import './cockpit.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: '自媒体智能管理平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <MainLayout>{children}</MainLayout>
      </body>
    </html>
  );
}
