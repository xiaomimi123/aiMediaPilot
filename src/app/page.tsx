import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { toProjectView } from '@/lib/project/view';
import { AccountCard } from '@/components/home/account-card';
import { buildAccountSummary } from '@/lib/account/summary';
import { readCollectStatus, readScanStatus } from '@/lib/douyin/collect-log';
import { findCandidate } from '@/lib/retro/match';
import { NewProjectButton } from '@/components/project/new-project-button';
import { latestForDisplay } from '@/lib/cli/commands/predict';
import { fmtViews } from '@/lib/predict/formula';
import type { PredictionView } from '@/lib/predict/view';

export const dynamic = 'force-dynamic';

const STAGE_TEXT: Record<string, string> = { draft: '写稿中', scripted: '已定稿', recorded: '已录制', final: '已出成片', published: '已发布' };

export default async function Home({ searchParams }: { searchParams?: { sort?: string } }) {
  const sort = searchParams?.sort === 'predict' ? 'predict' : 'updated';
  const [loaded, summary] = await Promise.all([
    prisma.project.findMany({ orderBy: { updatedAt: 'desc' } }).then((rows) => rows.map(toProjectView)),
    Promise.all([readCollectStatus(), readScanStatus()]).then(([c, sc]) => buildAccountSummary(prisma, c, sc)),
  ]);
  // 已定稿未发布的项目显示预测; 按预测排序时有中枢的排前面
  const unpublished = new Set((await prisma.project.findMany({ where: { publishedWorks: { none: {} }, stage: { not: 'draft' } }, select: { id: true } })).map((p) => p.id));
  const preds = new Map<string, PredictionView>();
  for (const id of unpublished) {
    const v = await latestForDisplay(prisma, id);
    if (v) preds.set(id, v);
  }
  const centerOf = (id: string) => preds.get(id)?.result.center ?? null;
  const projects =
    sort === 'predict'
      ? [...loaded].sort((a, b) => {
          const ca = centerOf(a.id);
          const cb = centerOf(b.id);
          if (ca === null && cb === null) return 0;
          if (ca === null) return 1;
          if (cb === null) return -1;
          return cb - ca;
        })
      : loaded;
  // 复盘提示: 近 24 小时新出的复盘 + 等确认关联的作品
  const newRetros = await prisma.retro.count({ where: { updatedAt: { gte: new Date(Date.now() - 86400_000) } } });
  let pendingLinks = 0;
  for (const p of await prisma.project.findMany({ where: { stage: 'final' }, select: { id: true } })) if (await findCandidate(prisma, p.id)) pendingLinks++;
  return (
    <div className="h-full overflow-y-auto p-8">
      <AccountCard summary={summary} />
      {(newRetros > 0 || pendingLinks > 0) && (
        <Link href="/retro" className="-mt-3 mb-6 block text-sm text-[var(--accent)] hover:underline">
          {[newRetros > 0 ? `有 ${newRetros} 份新复盘` : '', pendingLinks > 0 ? `${pendingLinks} 条作品等你确认是哪个项目发的` : ''].filter(Boolean).join('，')} →
        </Link>
      )}
      <div className="mb-6 flex items-center">
        <h1 className="text-lg font-semibold">项目</h1>
        <Link href={sort === 'predict' ? '/' : '/?sort=predict'} className="ml-3 text-xs text-[var(--accent)]">
          {sort === 'predict' ? '按更新时间' : '按预测排序'}
        </Link>
        <div className="flex-1" />
        <NewProjectButton />
      </div>
      {projects.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">还没有项目。新建一个，和编导聊聊今天这条讲什么。</p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {projects.map((p) => (
            <li key={p.id}>
              {/* 窄窗口下标题单独一行: 横排时 truncate 的标题会被右侧定宽列挤成 0 宽 */}
              <Link
                href={`/projects/${p.id}`}
                className="flex flex-col gap-1 px-4 py-3 hover:bg-[var(--bg-surface-hover)] sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
                <span className="flex shrink-0 items-center gap-4 whitespace-nowrap text-xs">
                  <span className="text-[var(--text-secondary)]">{STAGE_TEXT[p.stage] ?? p.stage}</span>
                  {preds.has(p.id) && (
                    <span className="font-mono text-[var(--text-secondary)]">
                      {centerOf(p.id) === null ? '预测：待数据' : `预测 ~${fmtViews(centerOf(p.id)!)}`}
                    </span>
                  )}
                  <span className="font-mono text-[var(--text-tertiary)]">{p.report ? `约 ${p.report.totalSec} 秒` : '无稿'}</span>
                  <span className="font-mono text-[var(--text-tertiary)]">{new Date(p.updatedAt).toLocaleDateString('zh-CN')}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
