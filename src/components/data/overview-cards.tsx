import { pct, humanCount } from '@/lib/works/chart';
import { cn } from '@/lib/utils';

export interface OverviewSnapshot {
  windowStart: string;
  windowEnd: string;
  submissionCount: number;
  medianPlay: number;
  avgLike: number;
  avgComment: number;
  avgShare: number;
  avgPlayDurationSec: number;
  bounceRate2s: number;
  completionRate5s: number;
  coverClickRate: number;
  verticals: string[];
  fetchedAt: string;
}

/**
 * 抖音账号总览。
 *
 * 数据来自后台「投稿分析」(`item_analysis/overview`), 和作品列表接口**不是一套数**
 * —— 同一条作品列表报 22.4 万播, 分析报 4,985 播。抖音没说哪个是曝光哪个是有效
 * 播放, 所以这里只报分析口径, 并把这件事写在卡片下面。
 *
 * 每张卡都带**窗口和快照时间**: 这些数字会随时间涨, 而窗口是平台定的近 90 天,
 * 不是我们挑的。不说清楚就会让人拿一个 90 天的条均值当账号的历史水平。
 */
function Card({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-1.5 font-mono font-semibold leading-none tabular-nums',
          emphasis ? 'text-[2rem]' : 'text-2xl',
        )}
      >
        {value}
      </p>
      {note ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function OverviewCards({ snapshot }: { snapshot: OverviewSnapshot | null }) {
  if (!snapshot) {
    return (
      <section className="mb-6 rounded-md border-l-2 border-destructive/70 bg-destructive/[0.06] px-4 py-3">
        <p className="text-sm font-medium text-destructive">还没有投稿分析数据</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          完播率、跳出率、封面点击率这些要从抖音后台的「投稿分析」取，跑一次
          <code className="mx-1 rounded bg-secondary px-1 py-0.5 text-xs">npm run collect:douyin</code>
          就有了。
        </p>
      </section>
    );
  }

  const s = snapshot;
  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">抖音数据总览</h2>
        <p className="text-xs text-muted-foreground">
          窗口 {s.windowStart} → {s.windowEnd}（平台定的近 90 天，改不了）· 快照于{' '}
          {s.fetchedAt.slice(0, 16).replace('T', ' ')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="5秒完播率"
          value={pct(s.completionRate5s)}
          note="开头 5 秒留住了多少人。前 3 秒的写法直接决定它。"
          emphasis
        />
        <Card
          label="2秒跳出率"
          value={pct(s.bounceRate2s)}
          note="两秒内划走的比例。它和完播率不是互补的，中间那段是「看了一会儿」。"
          emphasis
        />
        <Card
          label="封面点击率"
          value={pct(s.coverClickRate)}
          note="刷到的人里有多少点进来。封面和标题的活儿。"
          emphasis
        />
        <Card
          label="条均播放时长"
          value={`${s.avgPlayDurationSec.toFixed(1)}s`}
          note="平均看了多久。除以片长就是真实的完播情况。"
          emphasis
        />
        <Card label="播放量中位数" value={humanCount(s.medianPlay)} note="分析口径，不是列表口径。" />
        <Card label="条均点赞" value={String(s.avgLike)} />
        <Card label="条均评论" value={String(s.avgComment)} />
        <Card label="条均分享" value={String(s.avgShare)} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            平台判定的垂类
          </p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            {s.verticals.length === 0 ? (
              <span className="text-sm text-muted-foreground">平台还没判定</span>
            ) : (
              s.verticals.map((v) => (
                <span key={v} className="rounded-full bg-secondary px-2.5 py-1 text-xs">
                  {v}
                </span>
              ))
            )}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            这是<span className="text-foreground">抖音认为</span>你在做的赛道，不是你自己认的。
            两者差得远，就说明推荐系统还没把你归到你想去的池子里。
          </p>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            窗口内投稿量
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
            {s.submissionCount}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            上面那些条均值是按这 {s.submissionCount} 条算的。
            {s.submissionCount < 5
              ? '样本这么少，条均值一条爆款就能带偏——当参考，别当结论。'
              : ''}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        <span className="text-foreground">口径提醒：</span>
        这一组来自后台「投稿分析」，和下面作品列表的播放量<span className="text-foreground">不是一套数</span>
        ——同一条作品，列表报 22.4 万播、分析报 4,985 播。抖音没说明哪个是曝光、哪个是有效播放，
        所以两组都摆出来，不替它挑一个当真相。
      </p>
    </section>
  );
}
