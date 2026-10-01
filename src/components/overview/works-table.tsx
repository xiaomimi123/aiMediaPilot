'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { WorkRow } from '@/lib/overview/load';
import { fmtViews } from '@/lib/predict/formula';
import { cn } from '@/lib/utils';

const COLS = [
  { key: 'views', label: '播放', fmt: (v: number) => fmtViews(v), verdict: 'views' },
  { key: 'hook5s', label: '5秒完播', fmt: (v: number) => `${Math.round(v * 100)}%`, verdict: 'hook5s' },
  { key: 'avgViewSec', label: '平均观看', fmt: (v: number) => `${v.toFixed(1)} 秒`, verdict: 'middle' },
  { key: 'likeRate', label: '点赞率', fmt: (v: number) => `${(v * 100).toFixed(1)}%`, verdict: 'like' },
] as const;
const TONE: Record<string, string> = { good: 'text-[var(--success)]', bad: 'text-[var(--danger)]' };

export function WorksTable({ rows }: { rows: WorkRow[] }) {
  const [sort, setSort] = useState<(typeof COLS)[number]['key'] | null>(null);
  if (!rows.length) return <div className="card text-sm text-[var(--text-secondary)]">发布第一条后这里会出现对比</div>;
  const sorted = sort ? [...rows].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1)) : rows;
  const max = Math.max(...rows.map((r) => r.views ?? 0), 1);
  return (
    <div className="card overflow-x-auto">
      <div className="t-label mb-2">作品表现对比</div>
      <table className="w-full min-w-[520px] text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-[var(--text-tertiary)]">
            <th className="py-2 font-normal">作品</th>
            {COLS.map((c) => (
              <th key={c.key} className="py-2 font-normal">
                <button className={cn(sort === c.key && 'font-semibold text-[var(--accent)]')} onClick={() => setSort(c.key)}>
                  {c.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="border-t border-[var(--border-subtle)]">
              <td className="max-w-[220px] py-2 pr-3">
                <Link href={r.href} target={r.external ? '_blank' : undefined} className="block truncate hover:text-[var(--accent)]">
                  {r.title}
                </Link>
                <div className="mt-1 h-1.5 rounded-full bg-[var(--bg-elevated)]">
                  <div className="h-1.5 rounded-full bg-[var(--chart)]" style={{ width: `${((r.views ?? 0) / max) * 100}%` }} />
                </div>
              </td>
              {COLS.map((c) => {
                const v = r[c.key];
                return (
                  <td key={c.key} className={cn('py-2 pr-3', TONE[r.verdicts[c.verdict]])}>
                    {v === null ? '—' : c.fmt(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
