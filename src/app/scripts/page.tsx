import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { readActsFromDraftOutput, scoreHardDimensions } from '@/lib/cockpit/script-score';

/**
 * 稿库(前端重建 · 阶段 3)。
 *
 * `/` 直接重定向到这里 —— 写稿是这个产品当前唯一跑通的能力(25 份稿子), 所以它
 * 就是落地页。骨架阶段先把真实列表渲染出来: 一个空壳落地页没有验证价值。
 *
 * 服务端直接读库而不是走自己的 API: 页面之间不共享状态, 每页独立取数(5.2)。
 * 硬指标是纯函数, 在服务端顺手算完, 不需要客户端再请求一次。
 */
// 读库的页面必须强制动态: 默认会被预渲染成静态, 构建时把当时的数据烤进产物,
// 之后新写的稿子永远不出现。
export const dynamic = 'force-dynamic';

export default async function ScriptsPage() {
  const user = await getOrCreateDefaultUser();
  const drafts = await prisma.scriptDraft.findMany({
    where: { userId: user.id, archivedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, topic: true, platform: true, createdAt: true, output: true },
  });

  const rows = drafts.map((d) => {
    const acts = readActsFromDraftOutput(d.output);
    const durationSec = acts?.reduce((n, a) => n + a.targetSec, 0) ?? 0;
    return {
      id: d.id,
      topic: d.topic,
      platform: d.platform,
      createdAt: d.createdAt,
      // 认不出六幕结构的旧稿不打分, 而不是显示一个误导人的 0 分
      hard: acts ? scoreHardDimensions(acts, durationSec) : null,
      durationSec: acts ? durationSec : null,
    };
  });

  return (
    <PageShell title="稿库" description={`${rows.length} 份稿子。点开进工作区改稿。`}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          还没有稿子。去「选题」挑一个，或者直接到「写稿」开一条。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/write/${r.id}`} className="block">
                <Card className="p-4 transition-colors hover:bg-accent">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.topic}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.platform}
                        {r.durationSec ? ` · ${r.durationSec} 秒` : ' · 非六幕结构'}
                        {` · ${r.createdAt.toISOString().slice(0, 10)}`}
                      </p>
                    </div>
                    {r.hard ? (
                      <Badge variant={r.hard.total === r.hard.max ? 'default' : 'outline'}>
                        硬指标 {r.hard.total}/{r.hard.max}
                      </Badge>
                    ) : null}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
