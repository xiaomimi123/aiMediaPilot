import { buildBars, buildScatter, humanCount, pct } from '@/lib/works/chart';
import { cn } from '@/lib/utils';

/**
 * 两张图。手写 SVG, 不引图表库 —— 见 `@/lib/works/chart` 的说明。
 *
 * 两张图回答的是不同的问题:
 * - 柱状: **哪几条冒出来了**。所以基线是 0, 且高于中位数的染墨黑。
 * - 散点: **完播率和播放量有没有关系**。样本少的时候这张图什么都证明不了,
 *   所以点数不够时直接说这句话, 而不是画一张看起来像结论的图。
 */

/** 少于这个数就不画散点 —— 三个点连不出趋势, 画出来只会让人过度解读。 */
const SCATTER_MIN = 5;

export function PlayBars({
  rows,
  median,
}: {
  rows: { id: string; label: string; value: number }[];
  median: number;
}) {
  const bars = buildBars(rows, median);
  if (bars.length === 0) {
    return <p className="text-sm text-muted-foreground">没有计入基线的作品。</p>;
  }

  return (
    <div>
      <div className="flex h-40 items-end gap-1.5">
        {bars.map((b, i) => (
          <div key={rows[i].id} className="flex min-w-0 flex-1 flex-col justify-end" title={`${b.label}：${b.value.toLocaleString()} 播`}>
            <span className="mb-1 truncate text-center text-[0.65rem] tabular-nums text-muted-foreground">
              {humanCount(b.value)}
            </span>
            <div
              className={cn('w-full rounded-t-sm', b.highlight ? 'bg-primary' : 'bg-secondary')}
              // 最小 2px: 0 播的柱子完全消失会让人以为那条作品不存在
              style={{ height: `${Math.max(2, b.ratio * 110)}px` }}
            />
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        基线是 0，不是最小值——从非零起点画柱会把差不多的两条画成天壤之别。
        深色是高于中位数（{humanCount(median)}）的那几条。
      </p>
    </div>
  );
}

export function CompletionScatter({
  rows,
}: {
  rows: { id: string; label: string; play: number; completion: number }[];
}) {
  if (rows.length < SCATTER_MIN) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        只有 {rows.length} 条作品有完播率数据，画不出关系——
        <span className="text-foreground">{SCATTER_MIN} 个点以下的散点图什么都证明不了</span>，
        画出来只会让人过度解读。分析数据只覆盖近 90 天窗口内的投稿，多发几条就有了。
      </p>
    );
  }

  const pts = buildScatter(rows.map((r) => ({ label: r.label, x: r.play, y: r.completion })));
  return (
    <div>
      <svg viewBox="0 0 100 60" className="h-48 w-full" role="img" aria-label="完播率与播放量的关系">
        <line x1="0" y1="59" x2="100" y2="59" className="stroke-border" strokeWidth="0.4" />
        <line x1="0.5" y1="0" x2="0.5" y2="59" className="stroke-border" strokeWidth="0.4" />
        {pts.map((p, i) => (
          <circle
            key={rows[i].id}
            cx={2 + p.x * 96}
            cy={57 - p.y * 54}
            r="1.6"
            className="fill-primary"
          >
            <title>{`${p.label}\n${p.rawX.toLocaleString()} 播 · 完播 ${pct(p.rawY)}`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-1 text-xs text-muted-foreground">横轴播放量、纵轴 5 秒完播率，都是相对位置。</p>
    </div>
  );
}
