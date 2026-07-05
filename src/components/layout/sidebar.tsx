'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Wand2,
  Library,
  BarChart3,
  Settings,
  Sparkles,
  X,
  Plus,
  UserCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_NAME } from '@/lib/constants';

// /accounts (cookie/session 绑定) 和 /settings (AI provider key 管理) 是账号回收 &
// 自动 retro-sync 的唯一入口, IA 迁移时误删过, 现在恢复以避免"入口消失"。
// /settings 用顶层, 页面内已经包含 baseline 子路由跳转。
const NAV = [
  { href: '/agent', label: '智能体', icon: Wand2 },
  { href: '/content', label: '我的作品', icon: Library },
  { href: '/dashboard', label: '数据', icon: BarChart3 },
  { href: '/accounts', label: '账号', icon: UserCircle },
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
          'flex h-screen w-60 flex-col border-r bg-card',
          // Mobile: drawer over content; hidden by default
          'fixed inset-y-0 left-0 z-40 -translate-x-full transition-transform duration-200',
          open && 'translate-x-0',
          // Desktop: static, always visible
          'md:static md:translate-x-0',
        )}
      >
        {/* Header / Logo */}
        <div className="flex items-start gap-3 border-b px-5 py-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-sm">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex flex-1 flex-col">
            <div className="text-base font-semibold leading-tight">{APP_NAME}</div>
            <div className="mt-1 text-xs text-muted-foreground">单用户 MVP</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground md:hidden"
            aria-label="关闭菜单"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname?.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                  active
                    ? 'bg-brand-gradient text-white shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom CTA */}
        <div className="border-t p-3">
          <Link
            href="/agent"
            onClick={onClose}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient px-4 py-3 text-sm font-semibold text-white shadow-md transition-shadow hover:shadow-lg"
          >
            <Plus className="h-4 w-4" />
            新内容
          </Link>
        </div>
      </aside>
    </>
  );
}
