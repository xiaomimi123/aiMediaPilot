import type { Hypothesis, NextVideoAdvice, WorkLike } from '@/lib/works/insight';
import { extractCaptionFeatures } from '@/lib/works/insight';
import { cn } from '@/lib/utils';

const CONF_LABEL = { low: '置信度低', medium: '置信度中', high: '置信度高' } as const;

/**
 * AI 类作品的文案 × 流量分析。
 *
 * 每一条假设都把「有/没有」两组的条数和中位数摊开写 —— 只给一个「建议这样做」而不
 * 给依据, 用户没法判断该不该信。n 很小的时候尤其要这样: 一条爆款能让任何特征看起来
 * 都像成功因素, 摊开条数才看得出这一点。
 */
export function WorkInsight({
  works,
  hypotheses,
  advice,
}: {
  works: WorkLike[];
  hypotheses: Hypothesis[];
  advice: NextVideoAdvice;
}) {
  return (
    <>
      <section className="mb-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">下一条怎么做</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{advice.caveat}</p>

        {advice.suggestions.length === 0 ? null : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {advice.suggestions.map((s, i) => (
              <li key={i}>
                <p className="text-sm">
                  {s.text}
                  <span
                    className={cn(
                      'ml-2 rounded px-1.5 py-0.5 text-xs',
                      s.confidence === 'low' ? 'bg-destructive/10 text-destructive' : 'bg-secondary',
                    )}
                  >
                    {CONF_LABEL[s.confidence]}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.why}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">
          文案特征 × 播放{' '}
          <span className="text-xs font-normal text-muted-foreground">按差距排序</span>
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 font-normal">特征</th>
                <th className="py-1.5 text-right font-normal">有</th>
                <th className="py-1.5 text-right font-normal">中位播放</th>
                <th className="py-1.5 text-right font-normal">没有</th>
                <th className="py-1.5 text-right font-normal">中位播放</th>
                <th className="py-1.5 text-right font-normal">倍数</th>
              </tr>
            </thead>
            <tbody>
              {hypotheses.map((h) => (
                <tr key={h.key} className="border-b border-border last:border-0">
                  <td className="py-1.5">{h.label}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">{h.withCount}</td>
                  <td className="py-1.5 text-right tabular-nums">{h.withMedian.toLocaleString()}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">{h.withoutCount}</td>
                  <td className="py-1.5 text-right tabular-nums">{h.withoutMedian.toLocaleString()}</td>
                  <td className={cn('py-1.5 text-right tabular-nums', h.lift > 1.5 && 'font-medium')}>
                    {h.lift === Infinity ? '∞' : `${h.lift.toFixed(1)}×`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          倍数小于 1 不代表这个特征有害——样本这么少时，很可能只是那条爆款恰好没有它。
        </p>
      </section>

      <section className="mb-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">逐条看</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {[...works].sort((a, b) => b.play - a.play).map((w) => {
            const f = extractCaptionFeatures(w.caption, w.hashtags);
            const tags = [
              f.painPoint && '点了痛点',
              f.hasNumber && '有数字',
              f.hasQuestion && '有提问',
              f.firstPerson && '第一人称',
            ].filter(Boolean) as string[];
            return (
              <li key={w.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                  <span className="text-sm font-medium tabular-nums">{w.play.toLocaleString()} 播</span>
                  <span className="tabular-nums text-muted-foreground">{w.durationSec} 秒</span>
                  {tags.length > 0 ? (
                    tags.map((t) => (
                      <span key={t} className="rounded bg-secondary px-1.5 py-0.5">{t}</span>
                    ))
                  ) : (
                    <span className="text-muted-foreground">无明显特征</span>
                  )}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{w.caption || '(无文案)'}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
