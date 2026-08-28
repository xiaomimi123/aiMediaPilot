import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { buildLoopStatus, CALIBRATION_MIN_SAMPLES } from '@/lib/cockpit/feedback-loop';
import { assessCalibration } from '@/lib/works/calibration';
import { isUnwritten, readActsFromDraftOutput, scoreHardDimensions } from '@/lib/cockpit/script-score';
import Link from 'next/link';
import { HARD_WEIGHTS } from '@/lib/cockpit/script-score';
import { SOFT_DIMENSION_META } from '@/lib/llm/prompts/script-soft-score';
import { LoopStatus } from '@/components/overview/loop-status';

export const dynamic = 'force-dynamic';

const HARD_LABELS: Record<string, string> = {
  duration: '时长偏差', concise: '简洁度', trust: '信任声明',
  compliance: '平台合规', structure: '幕结构完整', universal: '普适化结尾',
};

/**
 * 校准(v5 阶段 E2)。
 *
 * 这一页当前的全部职责是**说清楚它为什么还不能工作**, 以及把「现在的权重是谁定的」
 * 摊开 —— 权重是按经验拍的, 没被任何真实数据修正过。用户有权知道他看到的分数
 * 建立在什么基础上。
 */
export default async function CalibrationPage() {
  const user = await getOrCreateDefaultUser();
  const [scriptCount, publishedCount, linkedWorks, claimable] = await Promise.all([
    prisma.scriptDraft.count({ where: { userId: user.id, archivedAt: null } }),
    prisma.cockpitContent.count({ where: { userId: user.id, publicationStatus: 'published' } }),
    // 已认领配对: 回采作品 ← 用哪份稿子发的。平台不返回这层关系, 只能由人认领。
    prisma.publishedWork.findMany({
      where: { userId: user.id, scriptDraftId: { not: null } },
      select: { id: true, title: true, play: true, publishedAt: true, scriptDraftId: true },
      orderBy: { publishedAt: 'desc' },
    }),
    prisma.publishedWork.count({
      where: { userId: user.id, scriptDraftId: null, play: { gt: 0 } },
    }),
  ]);

  // 逐条取预测分。稿子打不出分(非六幕/还没写)的配对不算数 —— 没有预测分就没有
  // 可对照的东西, 计进去只会让「样本够了」变成谎话。
  const drafts = linkedWorks.length
    ? await prisma.scriptDraft.findMany({
        where: { id: { in: linkedWorks.map((w) => w.scriptDraftId as string) } },
        select: { id: true, topic: true, output: true },
      })
    : [];
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  const pairs = linkedWorks.map((w) => {
    const d = draftById.get(w.scriptDraftId as string);
    const acts = d ? readActsFromDraftOutput(d.output) : null;
    const scorable = acts !== null && !isUnwritten(acts);
    const hard = scorable
      ? scoreHardDimensions(acts, acts.reduce((n, a) => n + a.targetSec, 0))
      : null;
    return {
      workId: w.id,
      title: w.title,
      play: w.play,
      publishedAt: w.publishedAt.toISOString().slice(0, 10),
      topic: d?.topic ?? '(稿子已删除)',
      predictedHard: hard ? hard.total : null,
      hardMax: hard ? hard.max : 0,
    };
  });

  const readiness = assessCalibration(pairs, claimable, CALIBRATION_MIN_SAMPLES);
  const layers = buildLoopStatus({ scriptCount, publishedCount, measuredCount: readiness.paired });

  return (
    <PageShell title="校准" description="把预测分和实际表现放进同一张图，让评分模型逐渐变准。">
      {/*
        样本数曾经是硬编码的 0。那个 0 当时是对的(确实一条都没有), 但它意味着
        **哪怕你真发了一条系统写的稿子, 校准也永远不会自己接上** —— 因为回采回来的
        作品和库里的稿子之间原本没有任何对应关系。现在读真数。
      */}
      <section
        className={
          readiness.ready
            ? 'mb-6 rounded-md border border-border bg-card p-4'
            : 'mb-6 rounded-md border-l-2 border-destructive/70 bg-destructive/[0.06] px-4 py-3'
        }
      >
        <p className={readiness.ready ? 'text-sm font-medium' : 'text-sm font-medium text-destructive'}>
          {readiness.ready
            ? `样本够了：${readiness.paired} 条配对`
            : `校准还跑不起来，配对样本 ${readiness.paired} 条`}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          校准要的是「预测分 vs 实际表现」的配对，至少 {CALIBRATION_MIN_SAMPLES} 条。
          {readiness.missing > 0 ? ` 还差 ${readiness.missing} 条。` : ' '}
          平台不会告诉系统哪条作品是用哪份稿子发的，只能你自己认领。
        </p>
        {readiness.claimable > 0 ? (
          <p className="mt-2 text-sm">
            <Link href="/data" className="underline underline-offset-4">
              去数据页认领
            </Link>
            <span className="text-muted-foreground">
              {' '}—— 有 {readiness.claimable} 条有播放量的作品还没关联稿子。
            </span>
          </p>
        ) : null}
      </section>

      {pairs.length > 0 ? (
        <section className="mb-6 rounded-md border border-border bg-card p-4">
          <h2 className="text-sm font-medium">已认领的配对</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {pairs.map((p) => (
              <li key={p.workId} className="flex flex-wrap items-baseline gap-x-3 text-xs">
                <span className="min-w-0 flex-1 truncate">{p.title || '(无标题)'}</span>
                <span className="tabular-nums text-muted-foreground">{p.play.toLocaleString()} 播</span>
                <span className="tabular-nums">
                  {p.predictedHard === null ? (
                    <span className="text-destructive">稿子打不出分</span>
                  ) : (
                    `预测硬指标 ${p.predictedHard}/${p.hardMax}`
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <LoopStatus layers={layers} />

      <section className="mt-6 rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-medium">当前权重是怎么来的</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          下面这套权重是<span className="font-medium text-foreground">按经验定的</span>，
          没有被任何真实表现数据修正过。校准跑起来之后，它会被真实完播率重新拟合——
          在那之前，分数的相对高低有参考价值，绝对值不必当真。
        </p>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium">硬指标 35（纯函数）</p>
            <ul className="mt-1.5 flex flex-col gap-1 text-xs">
              {Object.entries(HARD_WEIGHTS).map(([k, v]) => (
                <li key={k} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{HARD_LABELS[k] ?? k}</span>
                  <span className="tabular-nums">{v}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium">软指标 65（DeepSeek）</p>
            <ul className="mt-1.5 flex flex-col gap-1 text-xs">
              {SOFT_DIMENSION_META.map((d) => (
                <li key={d.key} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="tabular-nums">{d.max}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
