import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CalibrationData, AccuracyVerdict } from '@/lib/dashboard/types';

const DIM_LABELS: Array<{ key: keyof CalibrationData['matrix']; label: string; emoji: string }> = [
  { key: 'hookGap', label: '钩子', emoji: '🪝' },
  { key: 'retentionGap', label: '完播', emoji: '⏱' },
  { key: 'titleCaptionGap', label: '标题/文案', emoji: '📝' },
  { key: 'coverGap', label: '封面', emoji: '🖼' },
];

function pct(count: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((count / total) * 100)}%`;
}

function cellClass(verdict: AccuracyVerdict, isWorst: boolean): string {
  if (isWorst) return 'bg-destructive/10 border border-destructive/40 font-semibold';
  if (verdict === 'on-target') return 'text-green-700';
  return 'text-muted-foreground';
}

export function CalibrationMatrix({ data }: { data: CalibrationData }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">🎯 AI 预判校准</h3>
          <div className="text-xs text-muted-foreground">基于 {data.sampleCount} 条复盘</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 text-left">维度</th>
                <th className="py-2">✓ on-target</th>
                <th className="py-2">⚠ over</th>
                <th className="py-2">⚠ under</th>
                <th className="py-2">? unknown</th>
              </tr>
            </thead>
            <tbody>
              {DIM_LABELS.map(({ key, label, emoji }) => {
                const dist = data.matrix[key];
                return (
                  <tr key={key} className="border-b text-center">
                    <td className="py-2 text-left">{emoji} {label}</td>
                    <td className={cn('py-2', cellClass('on-target', dist.worstBucket === 'on-target'))}>
                      {pct(dist.onTarget, dist.total)} ({dist.onTarget})
                    </td>
                    <td className={cn('py-2', cellClass('over-estimated', dist.worstBucket === 'over-estimated'))}>
                      {pct(dist.overEstimated, dist.total)} ({dist.overEstimated})
                    </td>
                    <td className={cn('py-2', cellClass('under-estimated', dist.worstBucket === 'under-estimated'))}>
                      {pct(dist.underEstimated, dist.total)} ({dist.underEstimated})
                    </td>
                    <td className={cn('py-2', cellClass('unknown', dist.worstBucket === 'unknown'))}>
                      {pct(dist.unknown, dist.total)} ({dist.unknown})
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          💡 {data.insight}
        </div>
      </CardContent>
    </Card>
  );
}
