'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { WorkbenchData, TopicCard } from '@/lib/pipeline/types';
import { ContentCardView } from './content-card';

const COLUMNS = [
  { id: 'col-drafting', key: 'drafting', title: '📝 草稿' },
  { id: 'col-ready', key: 'ready', title: '✅ 定稿待拍' },
  { id: 'col-shot', key: 'shot', title: '🎬 已拍待发' },
  { id: 'col-published', key: 'published', title: '🚀 已发布' },
  { id: 'col-retroed', key: 'retroed', title: '📊 已复盘' },
] as const;

export function Kanban({ data, onChanged }: { data: WorkbenchData; onChanged: () => void }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      <TopicPoolColumn topics={data.topicPool} onChanged={onChanged} />
      {COLUMNS.map(({ id, key, title }) => (
        <section key={id} id={id} className="w-64 shrink-0 space-y-2">
          <h3 className="text-sm font-semibold">
            {title} <span className="text-muted-foreground">{data.counts[key]}</span>
          </h3>
          {data.columns[key].length === 0 && (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">空</p>
          )}
          {data.columns[key].map((c) => (
            <ContentCardView key={`${c.kind}-${c.id}`} card={c} />
          ))}
        </section>
      ))}
    </div>
  );
}

function TopicPoolColumn({ topics, onChanged }: { topics: TopicCard[]; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/topics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), source: 'manual' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message ?? '添加失败');
        return;
      }
      setTitle('');
      onChanged();
    } catch {
      setError('添加失败');
    } finally {
      setBusy(false);
    }
  };

  const discard = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/v1/topics/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'DISCARDED' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message ?? '丢弃失败');
        return;
      }
      onChanged();
    } catch {
      setError('丢弃失败');
    }
  };

  return (
    <section id="col-pool" className="w-64 shrink-0 space-y-2">
      <h3 className="text-sm font-semibold">
        💡 选题池 <span className="text-muted-foreground">{topics.length}</span>
      </h3>
      <div className="flex gap-1">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="快速添加选题…"
          className="w-full rounded-lg border bg-background px-2 py-1.5 text-xs"
        />
        <button onClick={add} disabled={busy} className="rounded-lg border px-2 text-xs">
          +
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {topics.length === 0 && (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">空</p>
      )}
      {topics.map((t) => (
        <div key={t.id} className="rounded-lg border bg-card p-3 text-sm shadow-sm">
          <div className="line-clamp-2 font-medium">{t.title}</div>
          {t.note && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.note}</p>}
          <div className="mt-2 flex gap-2 text-xs">
            <Link
              href={`/agent?topic=${encodeURIComponent(t.title)}&ideaId=${t.id}`}
              className="rounded bg-brand-gradient px-2 py-0.5 text-white"
            >
              开写
            </Link>
            <button onClick={() => discard(t.id)} className="text-muted-foreground hover:text-destructive">
              丢弃
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
