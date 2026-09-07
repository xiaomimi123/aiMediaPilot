'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { HOME_ITEM, NAV_GROUPS, SETTINGS_ITEM, activeNavHref, type NavItem } from '@/lib/nav';
import { APP_NAME } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * 侧栏(三十四期 UI 重做, 对照设计稿 .sidebar)。导航结构在 `@/lib/nav`, 这里只渲染。
 *
 * 与设计稿的两处对齐说明:
 * - 每项前面的小方块(.ico)是设计稿的图标占位 —— 选中时变靛蓝, 平时是描边灰。
 *   真图标以后换进来, 占位保证现在的版面节奏就是最终节奏。
 * - `!item.ready` 的黄点沿用旧语义「数据链路没通」, 不是设计稿里的「有东西等你」。
 *   两种语义将来可能都要, 到时候分两个颜色, 现在不合并。
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
        'flex w-full items-center gap-[9px] rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
        active
          ? 'bg-surface-hover text-fg'
          : 'text-fg-2 hover:bg-surface hover:text-fg',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-3.5 w-3.5 shrink-0 rounded-[4px]',
          active ? 'bg-brand' : 'bg-line-strong',
        )}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {!item.ready ? (
        <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full bg-warn" />
      ) : null}
    </Link>
  );
}

function WorkerCard({ health }: { health: Health | null }) {
  if (!health || health.ready) return null;
  const waiting = health.queues['video-production']?.waiting ?? 0;
  return (
    <div className="mb-1.5 rounded-lg border border-bad bg-bad-subtle px-2.5 py-2">
      <p className="flex items-center gap-2 text-[11px] font-medium text-bad">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-bad" />
        {health.redis === 'down' ? 'Redis 连不上' : '出片 worker 未运行'}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-fg-3">
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
    <aside className="sticky top-0 flex h-screen w-sidebar shrink-0 flex-col overflow-y-auto border-r border-line-subtle bg-base px-3 pb-3 pt-4">
      <Link href="/" className="flex items-center gap-2 px-2 pb-4">
        <span aria-hidden className="h-5 w-5 shrink-0 rounded-md bg-brand" />
        <span className="text-sm font-semibold text-fg">{APP_NAME}</span>
      </Link>

      <nav aria-label="主导航" className="flex flex-1 flex-col">
        <NavLink item={HOME_ITEM} active={active === HOME_ITEM.href} />
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="t-label px-2 pb-1 pt-3.5">{group.label}</p>
            <div className="flex flex-col gap-px">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={active === item.href} />
              ))}
            </div>
          </div>
        ))}
        <div className="flex-1" />
        <WorkerCard health={health} />
        <NavLink item={SETTINGS_ITEM} active={active === SETTINGS_ITEM.href} />
      </nav>
    </aside>
  );
}
