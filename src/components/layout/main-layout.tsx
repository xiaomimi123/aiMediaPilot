'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Header } from './header';

export function MainLayout({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  if (pathname === '/') return <>{children}</>;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onToggleNav={() => setNavOpen((v) => !v)} />
        <main className="flex-1 overflow-auto p-3 md:p-6">{children}</main>
      </div>
    </div>
  );
}
