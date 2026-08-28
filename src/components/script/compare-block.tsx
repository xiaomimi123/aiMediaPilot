'use client';

import { cn } from '@/lib/utils';
import { looksCopiedFromCompare } from '@/lib/llm/prompts/script-compare';

/**
 * 当前这一幕的对照版(二十三期)。
 *
 * 放在旁白正下方、编辑列里, 不放右侧那条 220px 窄栏 —— 并排读两段文字要宽度,
 * 挤在窄栏里只能一段一段看, 那就不叫对照了。
 *
 * **刻意没有「一键采用」。** 手动敲一遍和点一下按钮, 差别不在工作量, 在于敲的
 * 过程里你会改。真采用了也不拦, 只是会在下面把重合度说出来。
 */

export interface CompareAct {
  act: string;
  rewritten: string;
  whatChanged: string;
  /** 这一幕本来就写得对, whatChanged 说的是「它为什么成立」。 */
  keep: boolean;
  inventedNumbers: string[];
}

export function CompareBlock({
  compare,
  narration,
  original,
  stale,
}: {
  compare: CompareAct | null;
  narration: string;
  /** 出对照那一刻的正文 —— 判照抄必须有它, 见 looksCopiedFromCompare。 */
  original: string;
  /** 出对照之后正文又改过了 —— 对照的是旧版本。 */
  stale: boolean;
}) {
  if (!compare) return null;

  // keep 的那几幕对照版就是原文, 永远不该报照抄
  const copied =
    !compare.keep &&
    looksCopiedFromCompare({ narration, compare: compare.rewritten, original });

  return (
    <section
      className={cn(
        'rounded-md border p-3',
        // 「这一幕不用改」和「换个写法」是两件事, 长得一样就会被当成同一件事扫过去
        compare.keep ? 'border-border/60 bg-card' : 'border-border bg-secondary/40',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium">{compare.keep ? '这一幕不用改' : '对照写法'}</p>
        <p className="text-[11px] text-muted-foreground">
          {stale
            ? '这份对照是按你改动前的正文出的'
            : compare.keep
              ? '说清楚它为什么成立'
              : '同样的素材，换一种写法'}
        </p>
      </div>

      {/*
        「改了什么手法」放在改写后的句子**之上**。
        句子只是例子, 手法才是能带走的东西 —— 排在下面就会被当成注解跳过。
      */}
      <p className="mt-2 text-xs font-medium text-foreground">{compare.whatChanged}</p>

      {/* keep 时 rewritten 就是他自己的句子, 再抄一遍是噪音 */}
      {compare.keep ? null : (
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{compare.rewritten}</p>
      )}

      {compare.inventedNumbers.length > 0 ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-destructive">
          对照版里的 {compare.inventedNumbers.join('、')} 你原文没说过——它是编的，别照着学。
        </p>
      ) : null}

      {/*
        照抄了就说出来。不拦 —— 那是他的选择; 但「改写度」声称的是「这稿子还有多少
        是你的」, 对照版悄悄流进正文而指标毫无反应的话, 那个数字就开始骗人了。
      */}
      {copied ? (
        <p
          className={cn(
            'mt-2 border-t border-border pt-2 text-[11px] leading-relaxed',
            'text-muted-foreground',
          )}
        >
          你把对照版抄进来了。<span className="text-foreground">这段现在是 AI 的表达</span>——
          不拦你，但它会原样进成片，而 AI 也会把它写给别人。
        </p>
      ) : null}
    </section>
  );
}
