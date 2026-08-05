import { cn } from '@/lib/utils';
import type { CalibrationData, AccuracyVerdict } from '@/lib/dashboard/types';

const DIM_LABELS: Array<{ key: keyof CalibrationData['matrix']; label: string }> = [
  { key: 'hookGap', label: '钩子' },
  { key: 'retentionGap', label: '完播' },
  { key: 'titleCaptionGap', label: '标题/文案' },
  { key: 'coverGap', label: '封面' },
];

function pct(count: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((count / total) * 100)}%`;
}

function cellClass(verdict: AccuracyVerdict, isWorst: boolean): string {
  if (isWorst) return 'bg-[var(--clay)]/10 border border-[var(--clay)]/40 font-semibold';
  if (verdict === 'on-target') return 'text-green-700';
  return 'text-[var(--muted)]';
}

export function CalibrationMatrix({ data }: { data: CalibrationData }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[var(--ink)]">AI 预判校准</h3>
        <div className="text-xs text-[var(--muted)]">基于 {data.sampleCount} 条复盘</div>
      </div>

        {/* Desktop: 5-col table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                <th className="py-2 text-left">维度</th>
                <th className="py-2">✓ on-target</th>
                <th className="py-2">⚠ over</th>
                <th className="py-2">⚠ under</th>
                <th className="py-2">? unknown</th>
              </tr>
            </thead>
            <tbody>
              {DIM_LABELS.map(({ key, label }) => {
                const dist = data.matrix[key];
                return (
                  <tr key={key} className="border-b border-[var(--line)] text-center">
                    <td className="py-2 text-left">{label}</td>
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

        {/* Mobile: stacked cards per dim */}
        <div className="space-y-3 md:hidden">
          {DIM_LABELS.map(({ key, label }) => {
            const dist = data.matrix[key];
            return (
              <div key={key} className="rounded-md border border-[var(--line)] p-3">
                <div className="font-medium">{label}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className={cn('rounded p-2', cellClass('on-target', dist.worstBucket === 'on-target'))}>
                    <div className="text-xs">✓ on-target</div>
                    <div className="font-semibold tabular-nums">{pct(dist.onTarget, dist.total)} ({dist.onTarget})</div>
                  </div>
                  <div className={cn('rounded p-2', cellClass('over-estimated', dist.worstBucket === 'over-estimated'))}>
                    <div className="text-xs">⚠ over</div>
                    <div className="font-semibold tabular-nums">{pct(dist.overEstimated, dist.total)} ({dist.overEstimated})</div>
                  </div>
                  <div className={cn('rounded p-2', cellClass('under-estimated', dist.worstBucket === 'under-estimated'))}>
                    <div className="text-xs">⚠ under</div>
                    <div className="font-semibold tabular-nums">{pct(dist.underEstimated, dist.total)} ({dist.underEstimated})</div>
                  </div>
                  <div className={cn('rounded p-2', cellClass('unknown', dist.worstBucket === 'unknown'))}>
                    <div className="text-xs">? unknown</div>
                    <div className="font-semibold tabular-nums">{pct(dist.unknown, dist.total)} ({dist.unknown})</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          {data.insight}
        </div>
      </div>
  );
}
