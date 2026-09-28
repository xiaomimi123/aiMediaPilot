import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { toProjectView } from '@/lib/project/view';
import { AccountCard } from '@/components/home/account-card';
import { buildAccountSummary } from '@/lib/account/summary';
import { readCollectStatus, readScanStatus } from '@/lib/douyin/collect-log';
import { NewProjectButton } from '@/components/project/new-project-button';

export const dynamic = 'force-dynamic';

const STAGE_TEXT: Record<string, string> = { draft: '写稿中', scripted: '已定稿', recorded: '已录制', final: '已出成片' };

export default async function Home() {
  const [projects, summary] = await Promise.all([
    prisma.project.findMany({ orderBy: { updatedAt: 'desc' } }).then((rows) => rows.map(toProjectView)),
    Promise.all([readCollectStatus(), readScanStatus()]).then(([c, sc]) => buildAccountSummary(prisma, c, sc)),
  ]);
  return (
    <div className="h-full overflow-y-auto p-8">
      <AccountCard summary={summary} />
      <div className="mb-6 flex items-center">
        <h1 className="text-lg font-semibold">项目</h1>
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
