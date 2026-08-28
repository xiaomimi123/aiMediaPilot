'use client';

import { useState } from 'react';
import { MATERIAL_KINDS, MATERIAL_LABELS, type MaterialGap, type MaterialKind } from '@/lib/materials/model';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Row {
  id: string; kind: string; content: string; source: string; tags: string[]; createdAt: string;
}

/**
 * 素材库。
 *
 * 顶部先讲缺口再列内容: 这一栏真正的问题不是「我存了多少」, 而是「我缺哪一类」。
 * 亲身经历为 0 的时候, 列一百条书摘也没用 —— 那一百条 AI 自己也查得到。
 */
export function MaterialLibrary({ initial, gaps }: { initial: Row[]; gaps: MaterialGap[] }) {
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<MaterialKind | 'all'>('all');
  const [kind, setKind] = useState<MaterialKind>('experience');
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const shown = filter === 'all' ? rows : rows.filter((r) => r.kind === filter);
  const worst = gaps[0];

  async function add() {
    if (content.trim().length < 2) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/v1/materials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, content: content.trim(), source: source.trim(), tags: [] }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body?.message ?? '保存失败'); return; }
      const m = body.data.material;
      setRows((p) => [{ ...m, tags: [], createdAt: String(m.createdAt).slice(0, 10) }, ...p]);
      setContent('');
      setSource('');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/v1/materials/${id}`, { method: 'DELETE' });
    if (res.ok) setRows((p) => p.filter((r) => r.id !== id));
  }

  return (
    <>
      {worst && worst.count === 0 ? (
        <p className="mb-4 rounded-md border border-border bg-secondary/50 p-3 text-xs leading-relaxed">
          <span className="font-medium">{worst.label}一条都没有，是当前最短的一块。</span>{' '}
          <span className="text-muted-foreground">{worst.why}</span>
        </p>
      ) : null}

      <div className="mb-5 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap gap-1.5">
          {MATERIAL_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-colors',
                kind === k ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent',
              )}
            >
              {MATERIAL_LABELS[k]}
            </button>
          ))}
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder={kind === 'experience' ? '当时具体发生了什么？越具体越好' : '原文 / 数字 / 事例'}
          className="mt-3 w-full resize-y rounded-md border border-input bg-background p-3 text-sm"
        />
        <div className="mt-2 flex items-center gap-2">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={kind === 'data' || kind === 'quote' ? '出处（这一类没有出处基本不能用）' : '出处（可选）'}
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
          />
          <Button size="sm" disabled={saving || content.trim().length < 2} onClick={() => void add()}>
            {saving ? '记录中…' : '记一条'}
          </Button>
        </div>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={cn('rounded-full px-2.5 py-1 text-xs', filter === 'all' ? 'bg-secondary font-medium' : 'text-muted-foreground')}
        >
          全部 {rows.length}
        </button>
        {gaps.map((g) => (
          <button
            key={g.kind}
            type="button"
            title={g.why}
            onClick={() => setFilter(g.kind)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs',
              filter === g.kind ? 'bg-secondary font-medium' : 'text-muted-foreground',
              g.count === 0 && 'text-destructive',
            )}
          >
            {g.label} {rows.filter((r) => r.kind === g.kind).length}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">这一类还没有素材。</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
          {shown.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-4 p-3">
              <div className="min-w-0">
                <p className="text-sm leading-relaxed">{r.content}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {MATERIAL_LABELS[r.kind as MaterialKind] ?? r.kind}
                  {r.source ? ` · ${r.source}` : ''} · {r.createdAt}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(r.id)}
                className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
