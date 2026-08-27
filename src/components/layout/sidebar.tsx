'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, SETTINGS_ITEM, activeNavHref, type NavItem } from '@/lib/nav';
import { APP_NAME } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * 侧栏(前端重建 · 阶段 3)。
 *
 * 导航结构本身在 `@/lib/nav`, 这里只负责渲染 —— 「侧栏有几项、哪一项该亮」
 * 是能被单测钉住的事实, 不该只能靠肉眼看渲染结果。
 */

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      title={item.hint}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'block rounded-md px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-secondary font-medium text-secondary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname() ?? '/';
  const active = activeNavHref(pathname);

  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-background">
      <div className="px-4 py-5">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          {APP_NAME}
        </Link>
      </div>

      <nav aria-label="主导航" className="flex flex-1 flex-col gap-1 px-2">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} active={active === item.href} />
        ))}
      </nav>

      <div className="border-t border-border p-2">
        <NavLink item={SETTINGS_ITEM} active={active === SETTINGS_ITEM.href} />
      </div>
    </aside>
  );
}
