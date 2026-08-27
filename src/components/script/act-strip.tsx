'use client';

import type { ActPlan } from '@/lib/script/act-plan';
import type { ActKey } from '@/lib/script/six-act';
import { cn } from '@/lib/utils';

/**
 * 时长分配条(v5 设计稿)。六幕横排在顶部, 每幕一张卡。
 *
 * 从竖排左栏改成横排的理由: 这一条要回答的是「预算怎么分的」, 那是个**横向对比**
 * 的问题 —— 哪一幕吃掉了别人的份额, 排成一行扫一眼就看出来, 竖着排要上下来回看。
 *
 * 进度条按目标时长归一: 条满 = 刚好用完这一幕的预算, 超出的部分标红往外顶。
 */
export function ActStrip({
  plan,
  current,
  onSelect,
}: {
  plan: ActPlan;
  current: ActKey;
  onSelect: (act: ActKey) => void;
}) {
  return (
    <section className="rounded-lg border border-border">
      <header className="flex items-baseline justify-between gap-4 px-4 py-2.5">
        <h2 className="text-sm font-medium">时长分配</h2>
        <p className="text-xs tabular-nums text-muted-foreground">
          合计 {plan.totalActualSec.toFixed(1)}s
          {plan.overSec > 0 ? (
            <span className="ml-2 text-destructive">超出 {plan.overSec.toFixed(1)}s</span>
          ) : null}
        </p>
      </header>

      <div className="grid grid-cols-6 gap-px border-t border-border bg-border">
        {plan.rows.map((r) => {
          const pct = r.targetSec > 0 ? Math.min(100, (r.actualSec / r.targetSec) * 100) : 0;
          return (
            <button
              key={r.act}
              type="button"
              onClick={() => onSelect(r.act)}
              aria-current={current === r.act ? 'true' : undefined}
              className={cn(
                'px-3 py-2.5 text-left transition-colors',
                current === r.act ? 'bg-secondary' : 'bg-background hover:bg-accent',
              )}
            >
              <p className="truncate text-xs text-muted-foreground">{r.label}</p>
              <p className="mt-1 text-xs tabular-nums">
                <span className={cn('font-medium', r.warn && 'text-destructive')}>
                  {r.actualSec.toFixed(1)}
                </span>
                <span className="text-muted-foreground">/{r.targetSec.toFixed(1)}s</span>
              </p>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn('h-full rounded-full', r.warn ? 'bg-destructive' : 'bg-primary')}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {r.missing ? <p className="mt-1 text-xs text-destructive">缺这一幕</p> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
