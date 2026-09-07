import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import {
  isUnwritten,
  readActsFromDraftOutput,
  readCachedSoft,
  scoreHardDimensions,
} from '@/lib/cockpit/script-score';
import { cn } from '@/lib/utils';
import { ScriptRowActions } from '@/components/script/script-row-actions';

export const dynamic = 'force-dynamic';

/**
 * 稿库(v5 阶段 C)。
 *
 * 从卡片列表改成表格: 25 份稿子要横向比较硬分/软分/时长, 卡片一行只放得下一两个
 * 数字, 扫不出「哪几份分低」。表格是为比较而生的。
 *
 * 硬指标服务端现算(纯函数); 软指标读缓存, **模型换过的旧分不显示分数只显示"待重跑"** ——
 * 显示一个不可比的数字比不显示更糟。
 */
export default async function ScriptsPage() {
  const user = await getOrCreateDefaultUser();
  const drafts = await prisma.scriptDraft.findMany({
    // 归档的照样列出来(标记出来即可) —— 归档完就再也找不到, 那不是归档是隐藏
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 80,
    select: { id: true, topic: true, platform: true, createdAt: true, output: true, archivedAt: true },
  });

  const contents = await prisma.cockpitContent.findMany({
    where: { userId: user.id, scriptDraftId: { in: drafts.map((d) => d.id) } },
    select: { scriptDraftId: true, scriptScore: true },
  });
  const softOf = new Map(contents.map((c) => [c.scriptDraftId, c.scriptScore]));

  // 逐份统计「删了会牵动什么」。一次性按 draftId 分组查, 不在循环里打 N 次库。
  const ids = drafts.map((d) => d.id);
  const [dists, linkedWorks, linkedContents, linkedIdeas] = await Promise.all([
    prisma.distribution.groupBy({ by: ['scriptDraftId'], where: { scriptDraftId: { in: ids } }, _count: true }),
    prisma.publishedWork.groupBy({ by: ['scriptDraftId'], where: { scriptDraftId: { in: ids } }, _count: true }),
    prisma.cockpitContent.groupBy({ by: ['scriptDraftId'], where: { scriptDraftId: { in: ids } }, _count: true }),
    prisma.topicIdea.groupBy({ by: ['scriptDraftId'], where: { scriptDraftId: { in: ids } }, _count: true }),
  ]);
  const countOf = (
    g: { scriptDraftId: string | null; _count: number }[],
    id: string,
  ): number => g.find((x) => x.scriptDraftId === id)?._count ?? 0;
  const impactOf = (id: string) => ({
    distributions: countOf(dists, id),
    linkedWorks: countOf(linkedWorks, id),
    contents: countOf(linkedContents, id),
    topicIdeas: countOf(linkedIdeas, id),
  });

  const rows = drafts.map((d) => {
    const acts = readActsFromDraftOutput(d.output);
    if (!acts) {
      return { id: d.id, topic: d.topic, platform: d.platform, sixAct: false as const,
               unwritten: false as const, createdAt: d.createdAt,
               archived: d.archivedAt !== null, impact: impactOf(d.id) };
    }
    // 骨架稿(台词全空)是六幕, 但分数没有意义 —— 空稿子在时长、简洁度上天生满分
    if (isUnwritten(acts)) {
      return { id: d.id, topic: d.topic, platform: d.platform, sixAct: true as const,
               unwritten: true as const, createdAt: d.createdAt,
               archived: d.archivedAt !== null, impact: impactOf(d.id) };
    }
    const durationSec = acts.reduce((n, a) => n + a.targetSec, 0);
    const soft = readCachedSoft(softOf.get(d.id), acts);
    return {
      id: d.id,
      topic: d.topic,
      platform: d.platform,
      sixAct: true as const,
      unwritten: false as const,
      createdAt: d.createdAt,
      archived: d.archivedAt !== null,
      impact: impactOf(d.id),
      hard: scoreHardDimensions(acts, durationSec),
      durationSec,
      soft:
        soft && soft.staleReason !== 'model'
          ? { total: soft.dimensions.reduce((n, x) => n + x.score, 0), stale: soft.stale }
          : soft
            ? ('outdated' as const)
            : null,
    };
  });

  const sixAct = rows.filter((r) => r.sixAct);
  // 平均分只算**写过的**。空骨架进平均分会把它拉下去, 而那个下降不代表任何事情。
  const scorable = sixAct.filter((r) => !r.unwritten);
  const avg = scorable.length
    ? Math.round(scorable.reduce((n, r) => n + (r.hard?.total ?? 0), 0) / scorable.length)
    : 0;
  const unwrittenCount = sixAct.length - scorable.length;

  return (
    <PageShell
      title="稿库"
      description={
        `${rows.length} 份稿子，其中 ${sixAct.length} 份是六幕结构` +
        (unwrittenCount > 0 ? `（${unwrittenCount} 份还没写）` : '') +
        `。已写的平均硬指标 ${avg}/35。`
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有稿子。去「选题」挑一个开条。</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-normal">标题</th>
                <th className="px-3 py-2 font-normal">平台</th>
                <th className="px-3 py-2 text-right font-normal">硬</th>
                <th className="px-3 py-2 text-right font-normal">软</th>
                <th className="px-3 py-2 text-right font-normal">时长</th>
                <th className="px-3 py-2 text-right font-normal">更新</th>
                <th className="px-3 py-2 text-right font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    'border-b border-border last:border-0 hover:bg-accent',
                    r.archived ? 'opacity-55' : '',
                  )}
                >
                  <td className="px-3 py-2">
                    <Link href={`/write/${r.id}`} className="block truncate">
                      {r.topic}
                      {r.archived ? (
                        <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                          已归档
                        </span>
                      ) : null}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.platform}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                    {!r.sixAct ? (
                      <span className="text-muted-foreground">非六幕</span>
                    ) : r.unwritten ? (
                      // 骨架稿: 是六幕, 但还没写。给分数会是个假数字。
                      <span className="text-muted-foreground/70">未写</span>
                    ) : (
                      <span
                        className={cn(
                          'rounded px-2 py-0.5',
                          // 红色在这套视觉里只表示「这里有问题」。及格线以上不该染红,
                          // 否则一屏全是红点, 真正低分的那条反而看不出来。
                          r.hard.total / r.hard.max >= 0.8
                            ? 'bg-primary text-primary-foreground'
                            : r.hard.total / r.hard.max >= 0.5
                              ? 'bg-secondary'
                              : 'bg-destructive/10 text-destructive',
                        )}
                      >
                        {r.hard.total}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {!r.sixAct || r.unwritten ? '—' :
                      r.soft === null ? '未跑' :
                      r.soft === 'outdated' ? '待重跑' :
                      r.soft.stale ? `${r.soft.total}*` : r.soft.total}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {r.sixAct && !r.unwritten ? `${r.durationSec}s` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                    {r.createdAt.toISOString().slice(5, 10)}
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <ScriptRowActions
                      id={r.id}
                      topic={r.topic}
                      archived={r.archived}
                      impact={r.impact}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        软指标列：「未跑」= 还没花钱评过；「待重跑」= 评分模型换过，旧分不可比；带 * = 稿子在评分之后改过。
      </p>
    </PageShell>
  );
}
