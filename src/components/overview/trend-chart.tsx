'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

type Point = { day: string; fans: number | null; likes: number | null; views: number | null };
const SERIES = [
  { key: 'fans', label: '粉丝' },
  { key: 'likes', label: '获赞' },
  { key: 'views', label: '播放' },
] as const;
const MIN_DAYS = 7;

export function TrendChart({ trend, recordedDays }: { trend: Point[]; recordedDays: number }) {
  const [series, setSeries] = useState<(typeof SERIES)[number]['key']>('fans');
  const [range, setRange] = useState<7 | 30>(7);
  const pts = trend.slice(-range).map((p) => ({ day: p.day, v: p[series] })).filter((p): p is { day: string; v: number } => p.v !== null);
  const head = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="t-label mr-auto">账号走势</div>
      {SERIES.map((s) => (
        <button key={s.key} className={cn('chip', series === s.key && 'bg-[var(--accent)] text-[var(--text-on-accent)]')} onClick={() => setSeries(s.key)}>
          {s.label}
        </button>
      ))}
      {[7, 30].map((r) => (
        <button key={r} className={cn('chip', range === r && 'bg-[var(--accent-subtle)] text-[var(--accent)]')} onClick={() => setRange(r as 7 | 30)}>
          {`${r} 天`}
        </button>
      ))}
    </div>
  );
  if (recordedDays < MIN_DAYS || pts.length < 2)
    return (
      <div className="card">
        {head}
        <div className="flex h-40 items-center justify-center rounded-[var(--r-md)] bg-[var(--bg-inset)] text-sm text-[var(--text-secondary)]">{`已记录 ${recordedDays} 天，满 ${MIN_DAYS} 天显示曲线`}</div>
      </div>
    );
  const W = 600;
  const H = 160;
  const vs = pts.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo || 1;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * W, H - 12 - ((p.v - lo) / span) * (H - 24)] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = pts[pts.length - 1];
  return (
    <div className="card">
      {head}
      <div className="mb-1 font-display text-xl font-bold">{last.v.toLocaleString('en-US')}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label={`${SERIES.find((s) => s.key === series)!.label}近 ${range} 天`}>
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--chart)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#trend-fill)" />
        <path d={line} fill="none" stroke="var(--chart)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-[var(--text-tertiary)]">
        <span>{pts[0].day.slice(5)}</span>
        <span>{last.day.slice(5)}</span>
      </div>
    </div>
  );
}
