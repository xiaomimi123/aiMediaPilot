import Link from 'next/link';

/** 评分走势。只画硬指标 —— 软指标大多没跑或已过期, 混进来会画出一条假曲线。 */
export function ScoreTrend({
  rows,
}: {
  rows: { id: string; topic: string; hard: number; hardMax: number }[];
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">评分走势</h2>
        <p className="mt-2 text-xs text-muted-foreground">还没有能打分的六幕稿。</p>
      </section>
    );
  }

  const max = rows[0].hardMax;
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">评分走势</h2>
        <span className="text-xs text-muted-foreground">最近 {rows.length} 份 · 硬指标</span>
      </div>

      <div className="mt-3 flex h-28 items-end gap-1.5">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/write/${r.id}`}
            title={`${r.topic} — ${r.hard}/${max}`}
            className="flex-1 rounded-t bg-primary/80 transition-colors hover:bg-primary"
            style={{ height: `${Math.max(4, (r.hard / max) * 100)}%` }}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        均分 {Math.round(rows.reduce((n, r) => n + r.hard, 0) / rows.length)}/{max} · 最高{' '}
        {Math.max(...rows.map((r) => r.hard))}/{max}
      </p>
    </section>
  );
}
