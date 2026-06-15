import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatPlays } from '@/lib/prediction/formula';
import type { PredictionAccuracySummary, PredictionAccuracyEntry } from '@/lib/dashboard/types';

const VERDICT_BADGE: Record<
  PredictionAccuracyEntry['verdict'],
  { label: (delta: number) => string; cls: string }
> = {
  'in-range': {
    label: () => '准',
    cls: 'bg-green-100 text-green-900',
  },
  over: {
    label: (delta) => `偏高 -${delta}%`,
    cls: 'bg-red-100 text-red-900',
  },
  under: {
    label: (delta) => `偏低 +${delta}%`,
    cls: 'bg-blue-100 text-blue-900',
  },
};

export function PredictionAccuracy({ data }: { data: PredictionAccuracySummary }) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">🎯 L1 预测精度</h3>
          <div className="text-xs text-muted-foreground">基于 {data.totalSamples} 条复盘</div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat emoji="✓" label="准" count={data.inRangeCount} cls="bg-green-100 text-green-900" />
          <Stat emoji="⚠" label="偏高" count={data.overCount} cls="bg-red-100 text-red-900" />
          <Stat emoji="⚠" label="偏低" count={data.underCount} cls="bg-blue-100 text-blue-900" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 text-left">视频</th>
                <th className="py-2 text-right">预测</th>
                <th className="py-2 text-right">实际</th>
                <th className="py-2 text-right">落差</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((row) => {
                const badge = VERDICT_BADGE[row.verdict];
                return (
                  <tr key={row.id} className="border-b">
                    <td className="py-2">
                      <Link href={`/content/preflight/${row.id}`} className="truncate hover:text-primary">
                        {row.videoFilename}
                      </Link>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPlays(row.lower)} - {formatPlays(row.upper)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatPlays(row.actual)}</td>
                    <td className="py-2 text-right">
                      <span className={cn('rounded px-2 py-0.5 text-xs font-semibold', badge.cls)}>
                        {badge.label(row.deltaPct)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ emoji, label, count, cls }: { emoji: string; label: string; count: number; cls: string }) {
  return (
    <div className={cn('rounded-md px-3 py-2 text-center', cls)}>
      <div className="text-xs">
        {emoji} {label}
      </div>
      <div className="text-2xl font-bold tabular-nums">{count}</div>
    </div>
  );
}
