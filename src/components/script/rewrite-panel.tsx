'use client';

import type { RewriteComparison } from '@/lib/script/rewrite-diff';
import { ACT_LABELS, type ActKey } from '@/lib/script/six-act';
import { cn } from '@/lib/utils';

/**
 * 「我的版 vs AI 版」。
 *
 * 这一栏回答的不是「稿子好不好」, 而是**「这稿子还剩多少是 AI 的」**。
 *
 * 为什么这件事值得单独占一栏: 可模仿的内容会被算法抹平, 而 AI 写出来的正是最可
 * 模仿的那部分。一个字没改的幕会原样出现在成片里 —— 那几句话别人也能写出来,
 * 它们不构成你的任何东西。
 *
 * 不给「改写度越高越好」的结论: 有些幕本来就写得对, 改它是浪费。这里只把事实
 * 摆出来 —— 哪几幕还完全是 AI 的, 你自己判断该不该动。
 */
export function RewritePanel({
  comparison,
  hardTotal,
  baselineHardTotal,
  hardMax,
  imported = false,
}: {
  comparison: RewriteComparison | null;
  hardTotal: number;
  /** AI 原版的硬指标, 拿不到时传 null。 */
  baselineHardTotal: number | null;
  hardMax: number;
  /** 用户自己写好导入的稿子 —— 没有 AI 原版是设计如此。 */
  imported?: boolean;
}) {
  if (!comparison) {
    /*
     * 两种「没有对比」是不同的事, 说法必须分开。
     *
     * 导入稿本来就没有 AI 原版; 拿旧稿那套话术("下一份新稿会自动留底")去套,
     * 等于告诉他一件不会发生的事 —— 他会一直等一个永远不出现的对比。
     */
    return imported ? (
      <p className="text-xs leading-relaxed text-muted-foreground">
        这份稿子是你自己写的，<span className="text-foreground">改写度按定义就是 100%</span>——
        没有 AI 原版可比，也不需要有。左边的硬指标才是对它有用的那栏：
        它指出哪里啰嗦、哪一幕超时、缺什么声明，但不替你写句子。
      </p>
    ) : (
      <p className="text-xs leading-relaxed text-muted-foreground">
        这份稿子没有 AI 原版记录（在快照功能之前建的）。下一份新稿子会自动留底，
        之后这里能看到「你改了多少、改完分数怎么变」。
      </p>
    );
  }

  const pct = Math.round(comparison.overallRatio * 100);
  const delta = baselineHardTotal === null ? null : hardTotal - baselineHardTotal;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <section>
        <h2 className="font-medium">
          用你自己的话重写了{' '}
          <span className="tabular-nums">{pct}%</span>
        </h2>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 leading-relaxed text-muted-foreground">
          没改的部分会原样进成片。那几句 AI 也会写给别人，不构成你的东西。
        </p>
      </section>

      {delta !== null ? (
        <section className="border-t border-border pt-2.5">
          <p className="flex items-baseline justify-between gap-2">
            <span className="font-medium">改完之后硬指标</span>
            <span className="tabular-nums">
              {baselineHardTotal} → {hardTotal}
              <span
                className={cn(
                  'ml-1.5',
                  delta > 0 ? 'text-primary' : delta < 0 ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {delta > 0 ? `+${delta}` : delta}
              </span>
            </span>
          </p>
          {delta < 0 ? (
            <p className="mt-1 leading-relaxed text-muted-foreground">
              分数掉了不一定是改坏了——硬指标只管时长、垫话、结构这些能算的东西，
              管不了你注入的判断和亲身经历。但值得回头看一眼是不是哪一幕写超了。
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="border-t border-border pt-2.5">
        <h2 className="font-medium">逐幕</h2>
        <ul className="mt-1.5 flex flex-col gap-1">
          {comparison.acts.map((a) => {
            const p = Math.round(a.rewriteRatio * 100);
            return (
              <li key={a.act} className="flex items-center justify-between gap-2">
                <span className={cn(a.untouched && 'text-destructive')}>
                  {ACT_LABELS[a.act as ActKey] ?? a.act}
                </span>
                <span className={cn('tabular-nums', a.untouched ? 'text-destructive' : 'text-muted-foreground')}>
                  {a.untouched ? '一个字没改' : `${p}%`}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
