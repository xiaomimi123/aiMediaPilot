'use client';

import type { ActPlan } from '@/lib/script/act-plan';
import type { ActKey } from '@/lib/script/six-act';
import { cn } from '@/lib/utils';

/**
 * 左栏: 六幕导航(阶段 4)。
 *
 * **常驻, 不用 tab 也不滚动** —— ACT_KEYS 固定六项, 数量永远不变, 那就没有
 * 任何理由把它藏进 tab 里。每幕显示「实际 / 目标」两个数, 超出目标 10% 标黄。
 */
export function ActNav({
  plan,
  current,
  onSelect,
}: {
  plan: ActPlan;
  current: ActKey;
  onSelect: (act: ActKey) => void;
}) {
  return (
    <nav aria-label="六幕" className="flex w-[118px] shrink-0 flex-col gap-1">
      {plan.rows.map((r) => (
        <button
          key={r.act}
          type="button"
          onClick={() => onSelect(r.act)}
          aria-current={current === r.act ? 'true' : undefined}
          className={cn(
            'rounded-md px-2 py-2 text-left text-xs transition-colors',
            current === r.act
              ? 'bg-secondary font-medium text-secondary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <span className="block truncate">{r.label}</span>
          <span className={cn('mt-0.5 block tabular-nums', r.warn && 'text-destructive')}>
            {r.actualSec}s / {r.targetSec.toFixed(1)}s
          </span>
          {r.missing ? <span className="mt-0.5 block text-destructive">缺这一幕</span> : null}
        </button>
      ))}

      <div className="mt-2 border-t border-border px-2 pt-2 text-xs text-muted-foreground">
        <p className="tabular-nums">合计 {plan.totalActualSec}s</p>
        {plan.overSec > 0 ? (
          <p className="tabular-nums text-destructive">超出 {plan.overSec}s</p>
        ) : null}
      </div>
    </nav>
  );
}
