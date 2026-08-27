'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Health {
  ready: boolean;
  redis: 'up' | 'down';
  workers: { online: number };
  queues: Record<string, { waiting: number; failed: number } | null>;
  hint: string | null;
}

/**
 * 首页顶部的链路告警条。
 *
 * 它把技术状态翻译成**后果**: 不是「ready: false」, 而是「这条链路不通, 后面的
 * 发布和数据回采都无法开始」。worker 离线时任务只是静静排队, 界面上不说, 用户
 * 就会一直等一件永远不会发生的事。
 */
export function HealthBanner() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/health')
      .then((r) => r.json())
      .then((b) => { if (alive) setHealth(b?.data ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!health || health.ready) return null;

  const waiting = health.queues['video-production']?.waiting ?? 0;

  return (
    <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
      <p className="text-sm">
        <span className="font-medium text-destructive">
          {health.redis === 'down' ? 'Redis 连不上。' : '出片 worker 未运行。'}
        </span>{' '}
        <span className="text-muted-foreground">
          {waiting > 0 ? `${waiting} 个任务在队列里排着没人处理。` : ''}
          这条链路不通，后面的出片、发布和数据回采都无法开始。
        </span>{' '}
        <Link href="/films" className="underline underline-offset-4">
          去处理 →
        </Link>
      </p>
      {health.hint ? <p className="mt-1 text-xs text-muted-foreground">{health.hint}</p> : null}
    </div>
  );
}
