import { buildLine, linePath, deltaLabel, humanCount } from '@/lib/works/chart';
import { cn } from '@/lib/utils';

export interface MetricTrend {
  metric: string;
  currentCount: number;
  lastPeriodIncr: number;
  series: { date: string; value: number }[];
}

/**
 * 账号逐日趋势。
 *
 * 数据来自 `/aweme/janus/creator/data/overview/all/` —— 11 个指标各带一条日序列。
 * 接口只回最近 7 天, 但回采是每晚跑的, 所以库里的历史会自己越攒越长。
 *
 * 两件事故意不做:
 *
 * 1. **不把「当前值」和日序列换算成一个数**。粉丝的当前值是 2765, 日序列却是 395,
 *    平台没有说明这两个数各自的定义。硬凑一个「粉丝增长率」出来就是编。
 * 2. **不给指标编解释**。下面每项的中文名是我按字段名直译的, 平台没给定义 ——
 *    所以只写名字, 不写「这个指标说明你的内容如何如何」。
 */

/** 字段名 → 中文。只做直译, 不做解释。 */
const LABELS: Record<string, string> = {
  fans: '粉丝',
  new_fans: '新增粉丝',
  cancel_fans: '取关',
  play: '播放',
  digg: '点赞',
  comment: '评论',
  share: '分享',
  profile: '主页访问',
  account_search: '账号被搜',
  post_search: '作品被搜',
  music_create: '音乐使用',
};

/** 展示顺序: 先看涨没涨粉, 再看内容表现, 最后是被搜索这类弱信号。 */
const ORDER = [
  'fans', 'new_fans', 'cancel_fans', 'profile',
  'play', 'digg', 'comment', 'share',
  'account_search', 'post_search', 'music_create',
];

function Spark({ trend }: { trend: MetricTrend }) {
  const pts = buildLine(trend.series);
  const d = linePath(pts);
  const delta = deltaLabel(trend.lastPeriodIncr);
  const span = trend.series.length;

  return (
    <div className="rounded-md border border-border bg-card p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {LABELS[trend.metric] ?? trend.metric}
        </p>
        <span
          className={cn(
            'text-xs tabular-nums',
            delta.tone === 'up'
              ? 'text-foreground'
              : delta.tone === 'down'
                ? 'text-destructive'
                : 'text-muted-foreground/60',
          )}
        >
          {delta.text}
        </span>
      </div>

      <p className="font-serif-cn mt-1 text-xl font-semibold leading-none tabular-nums">
        {humanCount(trend.currentCount)}
      </p>

      {d ? (
        <svg viewBox="0 0 100 40" className="mt-2 h-12 w-full" preserveAspectRatio="none" role="img"
             aria-label={`${LABELS[trend.metric] ?? trend.metric} 最近 ${span} 天走势`}>
          <path d={d} fill="none" className="stroke-primary" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          {pts.length > 0 ? (
            <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="1.4" className="fill-primary" />
          ) : null}
        </svg>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground/60">还没有序列</p>
      )}

      <p className="mt-1 text-[0.65rem] tabular-nums text-muted-foreground/60">
        {span > 0 ? `${trend.series[0].date.slice(5)} → ${trend.series[span - 1].date.slice(5)} · ${span} 天` : ''}
      </p>
    </div>
  );
}

export function TrendCharts({ trends }: { trends: MetricTrend[] }) {
  if (trends.length === 0) {
    return (
      <section className="mb-6 rounded-md border-l-2 border-destructive/70 bg-destructive/[0.06] px-4 py-3">
        <p className="text-sm font-medium text-destructive">还没有账号趋势数据</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          跑一次 <code className="rounded bg-secondary px-1 py-0.5 text-xs">npm run collect:douyin</code> 就有了。
        </p>
      </section>
    );
  }

  // 没在 ORDER 里的指标(平台以后新增的)排到最后, 而不是排到最前
  const rank = (m: string): number => {
    const i = ORDER.indexOf(m);
    return i === -1 ? ORDER.length : i;
  };
  const sorted = [...trends].sort((a, b) => rank(a.metric) - rank(b.metric));

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">账号趋势</h2>
        <p className="text-xs text-muted-foreground">
          抖音只回最近 7 天，但每晚回采一次，这里的历史会自己越攒越长。
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {sorted.map((t) => (
          <Spark key={t.metric} trend={t} />
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        大字是平台给的<span className="text-foreground">当前值</span>，右上角是环比，曲线是逐日序列。
        注意这两者<span className="text-foreground">对不上</span>——粉丝当前值 2,765、日序列却是 395 一线，
        平台没说明各自的定义，所以都按原样摆，不替它换算。
      </p>
    </section>
  );
}
