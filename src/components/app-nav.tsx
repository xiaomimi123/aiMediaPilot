'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Compass, LayoutDashboard, Clapperboard, Settings, PenLine } from 'lucide-react';
import { cn } from '@/lib/utils';

export const NAV_ITEMS = [
  { href: '/', label: '总览', icon: LayoutDashboard },
  { href: '/works', label: '作品', icon: Clapperboard },
  { href: '/drafts', label: '写稿', icon: PenLine },
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
    <nav data-testid="sidebar" className="flex w-[var(--sidebar-w)] shrink-0 flex-col gap-1 border-r border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-5">
      <div className="mb-5 flex items-center gap-2.5 px-2">
        <span className="h-2.5 w-2.5 shrink-0 bg-[var(--accent)]" aria-hidden />
        <div>
          <div className="text-[15px] font-extrabold tracking-tight">MediaPilot</div>
          <div className="text-[15px] text-[var(--text-secondary)]">出片工作台</div>
        </div>
      </div>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const on = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? 'page' : undefined}
              className={cn('flex items-center gap-3 rounded-[var(--r-md)] px-3 py-2.5 text-[15px]', on ? 'bg-[var(--accent-subtle)] font-semibold text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]')}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
    </nav>
  );
}
