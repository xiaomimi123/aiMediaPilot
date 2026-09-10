import { cn } from '@/lib/utils';
import { planDayStatusLabel, type ContentPlanDayStatus } from '@/lib/content-plan/status-label';
import { pillarCoverageWarnings } from '@/lib/content-plan/pillar-check';

export interface PlanListDay {
  dayIndex: number;
  date: string; // "YYYY-MM-DD", 由调用方用 startDate+dayIndex 算好传入
  pillarName: string;
  topic: string;
  status: ContentPlanDayStatus;
}

const STATUS_BADGE: Record<ContentPlanDayStatus, string> = {
  pending: 'bg-elevated text-fg-3',
  scripted: 'bg-info-subtle text-info',
  produced: 'bg-ok-subtle text-ok',
};

export interface PlanListProps {
  days: PlanListDay[];
  todayIndex: number | null;
  pillars: { name: string }[];
}

/**
 * 30 天列表 —— 今天高亮, 已过去且仍 pending 的天灰化标「已过」(不做顺移, YAGNI:
 * 见任务书)。顶部支柱覆盖警告用 `pillarCoverageWarnings`(纯函数, 只提示不重生成)。
 */
export function PlanList({ days, todayIndex, pillars }: PlanListProps) {
  const warnings = pillarCoverageWarnings(pillars, days);

  return (
    <section className="rounded-lg border border-line-subtle bg-surface">
      <div className="border-b border-line-subtle px-4 py-3.5">
        <h2 className="text-sm font-semibold text-fg">30 天规划</h2>
      </div>
      {warnings.length > 0 ? (
        <div className="border-b border-line-subtle bg-warn-subtle px-4 py-2.5">
          {warnings.map((w) => (
            <p key={w} className="text-xs text-warn">
              {w}
            </p>
          ))}
        </div>
      ) : null}
      <ul>
        {days.map((d) => {
          const isToday = d.dayIndex === todayIndex;
          const isPast = todayIndex !== null ? d.dayIndex < todayIndex : false;
          const isStale = isPast && d.status === 'pending';
          return (
            <li
              key={d.dayIndex}
              className={cn(
                'flex items-center gap-3 border-t border-line-subtle px-4 py-2.5 first:border-t-0',
                isToday && 'bg-brand/5',
                isStale && 'opacity-50',
              )}
              data-today={isToday || undefined}
            >
              <span className="w-14 shrink-0 font-mono text-xs text-fg-3">第 {d.dayIndex} 天</span>
              <span className="w-24 shrink-0 font-mono text-xs text-fg-3">{d.date}</span>
              <span className="w-20 shrink-0 truncate text-xs text-fg-3">{d.pillarName || '—'}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{d.topic}</span>
              {isStale ? (
                <span className="badge-base bg-elevated text-fg-3">已过</span>
              ) : (
                <span className={cn('badge-base', STATUS_BADGE[d.status])}>{planDayStatusLabel(d.status)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
