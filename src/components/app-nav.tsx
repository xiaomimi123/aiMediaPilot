'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Compass, LayoutDashboard, Clapperboard, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export const NAV_ITEMS = [
  { href: '/', label: '总览', icon: LayoutDashboard },
  { href: '/works', label: '作品', icon: Clapperboard },
  { href: '/topics', label: '选题', icon: Compass },
  { href: '/assistant', label: '助手', icon: Bot },
  { href: '/settings', label: '设置', icon: Settings },
] as const;

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/works') return pathname.startsWith('/works') || pathname.startsWith('/projects');
  return pathname.startsWith(href);
}

export function AppNav() {
  const pathname = usePathname() ?? '/';
  return (
    <>
      <nav data-testid="sidebar" className="hidden md:flex w-[var(--sidebar-w)] shrink-0 flex-col gap-1 bg-[var(--bg-base)] p-4">
        <div className="mb-4 px-2 font-display text-lg font-bold">MediaPilot</div>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const on = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? 'page' : undefined}
              className={cn('flex items-center gap-3 rounded-[var(--r-md)] px-3 py-2 text-[15px]', on ? 'bg-[var(--accent-subtle)] font-semibold text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]')}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div data-testid="tabbar-spacer" className="h-[var(--tabbar-h)] md:hidden" aria-hidden />
      <nav data-testid="tabbar" className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--tabbar-h)] items-stretch justify-around bg-[var(--bg-base)] shadow-[0_-1px_0_var(--border-subtle)] md:hidden">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const on = isActive(pathname, href);
          return (
            <Link key={href} href={href} aria-current={on ? 'page' : undefined} className={cn('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]', on ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]')}>
              <Icon size={20} />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
