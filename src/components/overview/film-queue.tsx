'use client';

import { useEffect, useState } from 'react';
import { canStartProduction } from '@/lib/cockpit/production-status';
import { Button } from '@/components/ui/button';

interface Row {
  id: string;
  title: string;
  mode: string;
  status: string;
  createdAt: string;
  errorMessage: string | null;
}

const LABEL: Record<string, string> = {
  queued: '排队中', source_uploaded: '视频已上传', directing: '构思分镜中', building: '搭建画面中',
  assembling: '拼接预览中', preview_ready: '预览就绪', approved: '已确认', rendering: '渲染中',
  packaging: '包装中', done: '已完成', failed: '生成失败',
};

/**
 * 出片队列。
 *
 * **发起任务之前先读 health**(全局约定): worker 不在时按钮禁用并把原因说出来,
 * 而不是让人点一个什么都不会发生的按钮 —— 那正是这条链路半年没跑通却没人发现的原因。
 */
export function FilmQueue({ rows }: { rows: Row[] }) {
  const [health, setHealth] = useState<{ ready: boolean; hint: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/health').then((r) => r.json()).then((b) => setHealth(b?.data ?? null)).catch(() => {});
  }, []);

  async function start(id: string) {
    setBusy(id);
    setNote(null);
    try {
      const res = await fetch(`/api/v1/cockpit/video-productions/${id}/start`, { method: 'POST' });
      const body = await res.json();
      setNote(res.ok ? (body.data?.hint ?? '已开始制作') : (body?.message ?? '启动失败'));
    } finally {
      setBusy(null);
    }
  }

  const done = rows.filter((r) => r.status === 'done').length;

  return (
    <>
      {health && !health.ready ? (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs leading-relaxed text-muted-foreground">
          {health.hint} 在此之前所有出片入口都是禁用的。
        </p>
      ) : null}

      {done === 0 ? (
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          成功出片 0 次。队列里的任务只有 worker 在跑的时候才会被消费。
        </p>
      ) : null}

      {note ? <p className="mb-3 text-xs text-muted-foreground">{note}</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有出片任务。</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm">{r.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {r.mode} · {r.createdAt} · {LABEL[r.status] ?? r.status}
                </p>
                {r.errorMessage ? (
                  <p className="mt-0.5 truncate text-xs text-destructive">{r.errorMessage}</p>
                ) : null}
              </div>
              {canStartProduction(r.status) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === r.id || health?.ready === false}
                  title={health?.ready === false ? (health.hint ?? '') : undefined}
                  onClick={() => void start(r.id)}
                >
                  {busy === r.id ? '启动中…' : r.status === 'failed' ? '重新制作' : '开始制作'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
