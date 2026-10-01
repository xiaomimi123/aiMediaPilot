'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HealthItem } from '@/lib/health/checks';

const DOT: Record<HealthItem['status'], string> = { ok: 'bg-[var(--success)]', warn: 'bg-[var(--warning)]', fail: 'bg-[var(--danger)]' };

export function HealthPanel() {
  const [items, setItems] = useState<HealthItem[] | null>(null);
  const load = useCallback(async () => {
    setItems(null);
    const j = await (await fetch('/api/settings/health')).json();
    setItems(j.success ? j.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="card">
      <div className="mb-3 flex items-center">
        <h3 className="text-[15px] font-semibold">依赖体检</h3>
        <div className="flex-1" />
        <button className="text-xs text-[var(--accent)]" onClick={() => void load()}>重新检查</button>
      </div>
      {items === null ? (
        <p className="text-sm text-[var(--text-secondary)]">检查中…</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.key} className="flex gap-3 text-sm">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[i.status]}`} />
              <div className="min-w-0">
                <div>
                  <b>{i.label}</b> <span className="text-[var(--text-secondary)]">{i.detail}</span>
                </div>
                {i.fix && <code className="mt-1 block text-xs text-[var(--text-tertiary)]">{i.fix}</code>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
