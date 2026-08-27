'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { HOME_ITEM, NAV_GROUPS, SETTINGS_ITEM, activeNavHref, type NavItem } from '@/lib/nav';
import { APP_NAME } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * 侧栏(v5)。导航结构在 `@/lib/nav`, 这里只负责渲染。
 *
 * 底部常驻 worker 状态卡: worker 不在时任务照常入队然后静静躺着 —— 实测一条任务
 * 从晚上 21:58 停到第二天凌晨, 界面上没有一个字的解释。这张卡就是那句解释,
 * 它必须常驻而不是只出现在某一页, 因为你可能在任何一页发起异步任务。
 */

interface Health {
  ready: boolean;
  redis: 'up' | 'down';
  workers: { online: number };
  queues: Record<string, { waiting: number; failed: number } | null>;
  hint: string | null;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      title={item.hint}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
        active
          ? 'bg-secondary font-medium text-secondary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <span>{item.label}</span>
      {/* 数据链路没通的用一个小点标出来, 而不是从导航里删掉 */}
      {!item.ready ? <span className="text-xs text-muted-foreground/60">·</span> : null}
    </Link>
  );
}

function WorkerCard({ health }: { health: Health | null }) {
  if (!health || health.ready) return null;
  const waiting = health.queues['video-production']?.waiting ?? 0;
  return (
    <div className="m-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
      <p className="text-xs font-medium text-destructive">
        {health.redis === 'down' ? 'Redis 连不上' : '出片 worker 未运行'}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {waiting > 0 ? `${waiting} 个任务在队列里等待。` : ''}
        {health.hint}
      </p>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname() ?? '/';
  const active = activeNavHref(pathname);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/health')
      .then((r) => r.json())
      .then((b) => { if (alive) setHealth(b?.data ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <aside className="flex w-48 shrink-0 flex-col overflow-y-auto border-r border-border bg-background">
      <div className="px-4 py-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          {APP_NAME}
        </Link>
      </div>

      <nav aria-label="主导航" className="flex flex-1 flex-col gap-3 px-2">
        <NavLink item={HOME_ITEM} active={active === HOME_ITEM.href} />
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1 text-xs text-muted-foreground/70">{group.label}</p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={active === item.href} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <WorkerCard health={health} />

      <div className="border-t border-border p-2">
        <NavLink item={SETTINGS_ITEM} active={active === SETTINGS_ITEM.href} />
      </div>
    </aside>
  );
}
