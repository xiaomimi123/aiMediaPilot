import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import type { BiggestMiss } from '@/lib/dashboard/types';

export function BiggestMisses({ items }: { items: BiggestMiss[] }) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <h3 className="font-semibold">📉 Top 失误 (过度乐观)</h3>
        {items.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            还没有失误数据 — 需要 ≥ 1 条复盘
          </div>
        ) : (
          <ol className="space-y-2 text-sm">
            {items.map((m, i) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">{i + 1}.</span>
                <Link href={`/content/preflight/${m.id}`} className="flex-1 truncate hover:text-primary">
                  {m.videoFilename}
                </Link>
                <span className="text-xs tabular-nums">
                  预 {m.predicted} → 实 {m.inferred}
                </span>
                <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive tabular-nums">
                  -{m.gap}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
