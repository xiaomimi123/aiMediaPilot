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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_NAME } from '@/lib/constants';

const NAV = [
  { href: '/dashboard', label: '总览', icon: LayoutDashboard },
  { href: '/accounts', label: '账号', icon: Users },
  { href: '/create', label: '创作', icon: PenSquare },
  { href: '/contents', label: '内容', icon: FileText },
  { href: '/competitors', label: '竞品', icon: Search },
  { href: '/calendar', label: '日历', icon: Calendar },
  { href: '/settings', label: '设置', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex h-screen w-56 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-6 text-lg font-semibold">
        {APP_NAME}
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
