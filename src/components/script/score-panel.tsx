'use client';

import type { ScoreDimension } from '@/lib/cockpit/script-score';
import { cn } from '@/lib/utils';

/**
 * 右栏: 评分与待处理(阶段 4)。
 *
 * **硬指标与软指标分开展示, 不合成一个总分条**: 硬指标是纯函数算的, 每条扣分
 * 都能指到具体是哪个词、哪一幕; 软指标是模型判断的, 同一稿两次跑分数会飘。
 * 两者可信度不同, 混在一起会让人把模型的猜测当成事实。
 *
 * 所以硬指标列出每条的扣分理由, 软指标只给分数条 —— 想看理由点开完整评分。
 */

function Bar({ score, max, warn }: { score: number; max: number; warn: boolean }) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn('h-full rounded-full', warn ? 'bg-destructive' : 'bg-primary')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function ScorePanel({
  hard,
  hardMax,
  hardDimensions,
  soft,
  softMax,
  softDimensions,
  softStaleReason = null,
  todos = [],
  unwritten = false,
}: {
  hard: number;
  hardMax: number;
  hardDimensions: ScoreDimension[];
  /** 没跑过软指标时传 null —— 展示"未评分"而不是 0 分。 */
  soft: number | null;
  softMax: number;
  softDimensions: ScoreDimension[];
  /** 软指标为什么不作数: 稿子改了 / 评分模型换了。两者提示语不同。 */
  softStaleReason?: 'script' | 'model' | null;
  /** 把扣分翻译成「去改哪一幕的什么」。只给分不给去处等于没评。 */
  todos?: { text: string; act?: string }[];
  /** 还一个字没写 —— 展示在等什么, 而不是一个空稿子刷出来的分数。 */
  unwritten?: boolean;
}) {
  if (unwritten) {
    return (
      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">还没开始写</p>
        <p className="leading-relaxed">
          左边每一幕的备注写着这一幕该干什么、需要什么材料。台词是空的——那是留给你的。
        </p>
        <p className="leading-relaxed">
          写下第一句，硬指标立刻开始算；软指标要调一次模型，在稿库里发起。
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 text-xs">
      <section>
        <h2 className="font-medium">
          硬指标 <span className="font-normal text-muted-foreground">· 纯函数</span>{' '}
          <span className="tabular-nums text-muted-foreground">
            {hard}/{hardMax}
          </span>
        </h2>
        <Bar score={hard} max={hardMax} warn={hard < hardMax * 0.6} />
        <ul className="mt-2 flex flex-col gap-2">
          {hardDimensions.map((d) => (
            <li key={d.key} className={cn(d.score === d.max && 'opacity-50')}>
              <p className="flex justify-between gap-2">
                <span>{d.label}</span>
                <span className="tabular-nums">
                  {d.score}/{d.max}
                </span>
              </p>
              {d.score < d.max ? (
                <p className="mt-0.5 leading-relaxed text-muted-foreground">{d.reason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-border pt-3">
        <h2 className="font-medium">
          软指标 <span className="font-normal text-muted-foreground">· DeepSeek</span>{' '}
          <span className="tabular-nums text-muted-foreground">
            {soft === null ? '未评分' : `${soft}/${softMax}`}
          </span>
        </h2>
        {softStaleReason === 'model' ? (
          <p className="mt-1 leading-relaxed text-destructive">
            这份分数是旧评分模型算的（维度和满分都变过），和现在的硬指标不可比。重跑一次才作数。
          </p>
        ) : softStaleReason === 'script' ? (
          <p className="mt-1 leading-relaxed text-destructive">
            稿子在评分之后改过，下面是旧稿的分数，仅供参考。
          </p>
        ) : null}
        {soft === null ? (
          <p className="mt-1 leading-relaxed text-muted-foreground">
            钩子力度、意外感、真实感这些要判断的项还没跑。它要调一次模型，在稿库里发起。
          </p>
        ) : (
          <>
            <Bar score={soft} max={softMax} warn={soft < softMax * 0.6} />
            <ul className="mt-2 flex flex-col gap-1">
              {softDimensions.map((d) => (
                <li key={d.key} className="flex justify-between gap-2">
                  <span>{d.label}</span>
                  <span className="tabular-nums">
                    {d.score}/{d.max}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {todos.length > 0 ? (
        <section className="border-t border-border pt-3">
          <h2 className="font-medium">
            待处理 <span className="tabular-nums text-muted-foreground">{todos.length}</span>
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {todos.map((t, i) => (
              <li key={i} className="leading-relaxed text-muted-foreground">
                · {t.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
