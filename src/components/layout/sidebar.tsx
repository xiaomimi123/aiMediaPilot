'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  PenSquare,
  FileText,
  Search,
  Calendar,
  Settings,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_NAME } from '@/lib/constants';

const NAV = [
  { href: '/dashboard', label: '总览', icon: LayoutDashboard },
  { href: '/accounts', label: '账号', icon: Users },
  { href: '/create', label: '创作', icon: PenSquare },
  { href: '/content/preflight', label: '内容预诊断', icon: Video },
  { href: '/contents', label: '内容', icon: FileText },
  { href: '/competitors', label: '竞品', icon: Search },
  { href: '/calendar', label: '日历', icon: Calendar },
  { href: '/settings', label: '设置', icon: Settings },
];

interface Props {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: Props) {
  const pathname = usePathname();
  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'flex h-screen w-56 flex-col border-r bg-card',
          // Mobile: drawer over content; hidden by default
          'fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform duration-200',
          open && 'translate-x-0',
          // Desktop: static, always visible
          'md:static md:translate-x-0',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-6 text-lg font-semibold">
          <span>{APP_NAME}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground md:hidden"
            aria-label="关闭菜单"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname?.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
