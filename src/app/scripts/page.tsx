import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import {
  readActsFromDraftOutput,
  readCachedSoft,
  scoreHardDimensions,
} from '@/lib/cockpit/script-score';
import { cn } from '@/lib/utils';

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
    where: { userId: user.id, archivedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, topic: true, platform: true, createdAt: true, output: true },
  });

  const contents = await prisma.cockpitContent.findMany({
    where: { userId: user.id, scriptDraftId: { in: drafts.map((d) => d.id) } },
    select: { scriptDraftId: true, scriptScore: true },
  });
  const softOf = new Map(contents.map((c) => [c.scriptDraftId, c.scriptScore]));

  const rows = drafts.map((d) => {
    const acts = readActsFromDraftOutput(d.output);
    if (!acts) {
      return { id: d.id, topic: d.topic, platform: d.platform, sixAct: false as const,
               createdAt: d.createdAt };
    }
    const durationSec = acts.reduce((n, a) => n + a.targetSec, 0);
    const soft = readCachedSoft(softOf.get(d.id), acts);
    return {
      id: d.id,
      topic: d.topic,
      platform: d.platform,
      sixAct: true as const,
      createdAt: d.createdAt,
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

  const scorable = rows.filter((r) => r.sixAct);
  const avg = scorable.length
    ? Math.round(scorable.reduce((n, r) => n + (r.hard?.total ?? 0), 0) / scorable.length)
    : 0;

  return (
    <PageShell
      title="稿库"
      description={`${rows.length} 份稿子，其中 ${scorable.length} 份是六幕结构。平均硬指标 ${avg}/35。`}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有稿子。去「选题」挑一个开条。</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-normal">标题</th>
                <th className="px-3 py-2 font-normal">平台</th>
                <th className="px-3 py-2 text-right font-normal">硬</th>
                <th className="px-3 py-2 text-right font-normal">软</th>
                <th className="px-3 py-2 text-right font-normal">时长</th>
                <th className="px-3 py-2 text-right font-normal">更新</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-accent">
                  <td className="px-3 py-2">
                    <Link href={`/write/${r.id}`} className="block truncate">
                      {r.topic}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.platform}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {r.sixAct ? (
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5',
                          r.hard.total / r.hard.max >= 0.8
                            ? 'bg-secondary'
                            : 'bg-destructive/10 text-destructive',
                        )}
                      >
                        {r.hard.total}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">非六幕</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                    {!r.sixAct ? '—' :
                      r.soft === null ? '未跑' :
                      r.soft === 'outdated' ? '待重跑' :
                      r.soft.stale ? `${r.soft.total}*` : r.soft.total}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                    {r.sixAct ? `${r.durationSec}s` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                    {r.createdAt.toISOString().slice(5, 10)}
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
