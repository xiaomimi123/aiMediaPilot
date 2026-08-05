'use client';

import { useCallback, useEffect, useState } from 'react';
import { distributionPlatformMeta } from '@/lib/pipeline/platforms';
import { DistributionModal } from './distribution-modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Item { id: string; platform: string; url: string; publishedAt: string; note: string | null }

export function DistributionSection({ scriptId }: { scriptId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);

  const reload = useCallback(() => {
    fetch(`/api/v1/scripts/${scriptId}/distributions`)
      .then((r) => r.json())
      .then((j) => j.success && setItems(j.data.items))
      .catch(() => {});
  }, [scriptId]);

  useEffect(reload, [reload]);

  const remove = async (id: string) => {
    await fetch(`/api/v1/distributions/${id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <section className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--panel-bg)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">📤 分发记录 ({items.length})</h3>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>+ 登记分发</Button>
      </div>
      {items.length === 0 && <p className="text-sm text-[var(--muted)]">还没登记分发。发到其他平台后把链接记在这里。</p>}
      {items.map((i) => {
        const meta = distributionPlatformMeta(i.platform);
        return (
          <div key={i.id} className="flex items-center gap-2 text-sm">
            <span className={cn('rounded px-1.5 py-0.5 text-xs', meta.badgeClass)}>{meta.label}</span>
            <a href={i.url} target="_blank" rel="noreferrer" className="flex-1 truncate underline">{i.url}</a>
            <span className="text-xs text-[var(--muted)]">{new Date(i.publishedAt).toLocaleDateString('zh-CN')}</span>
            <button onClick={() => remove(i.id)} className="text-xs text-[var(--muted)] hover:text-destructive">删除</button>
          </div>
        );
      })}
      {open && <DistributionModal scriptId={scriptId} onDone={reload} onClose={() => setOpen(false)} />}
    </section>
  );
}
