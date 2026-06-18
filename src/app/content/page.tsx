import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { KNOWN_NICHES } from '@/lib/llm/prompts/expert-persona';

const NICHE_LABEL_MAP = new Map(KNOWN_NICHES.map((n) => [n.key, n.label]));

const PLATFORM_BADGE: Record<string, { label: string; cls: string }> = {
  douyin: { label: '🎬 抖音', cls: 'bg-blue-100 text-blue-900' },
  xiaohongshu: { label: '📕 小红书', cls: 'bg-pink-100 text-pink-900' },
  gongzhonghao: { label: '📰 公众号', cls: 'bg-amber-100 text-amber-900' },
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  QUEUED: { label: '排队', cls: 'bg-muted text-muted-foreground' },
  PREPROCESSING: { label: '预处理', cls: 'bg-blue-100 text-blue-900' },
  ANALYZING: { label: '分析中', cls: 'bg-blue-100 text-blue-900' },
  COMPLETED: { label: '✓ 完成', cls: 'bg-green-100 text-green-900' },
  FAILED: { label: '✗ 失败', cls: 'bg-red-100 text-red-900' },
  CANCELLED: { label: '已取消', cls: 'bg-muted text-muted-foreground' },
};

type Row =
  | {
      kind: 'script';
      id: string;
      topic: string;
      platform: string;
      niche: string;
      createdAt: Date;
      analysisId: string | null;
    }
  | {
      kind: 'analysis';
      id: string;
      videoFilename: string;
      niche: string;
      status: string;
      createdAt: Date;
    };

export default async function ContentLibraryPage() {
  const user = await getOrCreateDefaultUser();
  const [scripts, analyses] = await Promise.all([
    prisma.scriptDraft.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, topic: true, platform: true, niche: true, createdAt: true, analysisId: true },
    }),
    prisma.contentAnalysis.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, videoFilename: true, niche: true, status: true, createdAt: true },
    }),
  ]);

  const rows: Row[] = [
    ...scripts.map<Row>((s) => ({
      kind: 'script' as const,
      id: s.id,
      topic: s.topic,
      platform: s.platform,
      niche: s.niche,
      createdAt: s.createdAt,
      analysisId: s.analysisId,
    })),
    ...analyses.map<Row>((a) => ({
      kind: 'analysis' as const,
      id: a.id,
      videoFilename: a.videoFilename,
      niche: a.niche,
      status: a.status,
      createdAt: a.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">📚 我的作品</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            脚本 + 视频分析 综合列表, 按时间倒序。
          </p>
        </div>
        <Link href="/agent">
          <Button variant="brand">+ 新内容</Button>
        </Link>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 pt-6 text-center">
            <p className="text-sm text-muted-foreground">还没有内容。 用智能体写第一个吧。</p>
            <Link href="/agent">
              <Button size="sm" variant="outline">写第一个 →</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-left">类型</th>
                  <th className="py-2 text-left">标题 / 文件</th>
                  <th className="py-2 text-left">垂类</th>
                  <th className="py-2 text-left">状态</th>
                  <th className="py-2 text-right">时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`} className="border-b">
                    {row.kind === 'script' ? (
                      <ScriptRow row={row} />
                    ) : (
                      <AnalysisRow row={row} />
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ScriptRow({ row }: { row: Extract<Row, { kind: 'script' }> }) {
  const platformBadge = PLATFORM_BADGE[row.platform] ?? { label: row.platform, cls: 'bg-muted' };
  return (
    <>
      <td className="py-2">
        <span className={`rounded px-2 py-0.5 text-xs ${platformBadge.cls}`}>
          📜 {platformBadge.label}
        </span>
      </td>
      <td className="py-2">
        <Link href={`/content/script/${row.id}`} className="hover:text-primary">
          {row.topic}
        </Link>
      </td>
      <td className="py-2 text-xs text-muted-foreground">
        {NICHE_LABEL_MAP.get(row.niche) ?? row.niche}
      </td>
      <td className="py-2 text-xs">
        {row.analysisId ? (
          <Link
            href={`/content/preflight/${row.analysisId}`}
            className="rounded bg-green-100 px-2 py-0.5 text-green-900 hover:bg-green-200"
          >
            ✓ 已用
          </Link>
        ) : (
          <span className="text-muted-foreground">草稿</span>
        )}
      </td>
      <td className="py-2 text-right text-xs text-muted-foreground tabular-nums">
        {new Date(row.createdAt).toLocaleString()}
      </td>
    </>
  );
}

function AnalysisRow({ row }: { row: Extract<Row, { kind: 'analysis' }> }) {
  const statusBadge = STATUS_BADGE[row.status] ?? { label: row.status, cls: 'bg-muted' };
  return (
    <>
      <td className="py-2">
        <span className="rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-900">
          🎬 视频分析
        </span>
      </td>
      <td className="py-2">
        <Link href={`/content/preflight/${row.id}`} className="hover:text-primary">
          {row.videoFilename}
        </Link>
      </td>
      <td className="py-2 text-xs text-muted-foreground">
        {NICHE_LABEL_MAP.get(row.niche) ?? row.niche}
      </td>
      <td className="py-2 text-xs">
        <span className={`rounded px-2 py-0.5 ${statusBadge.cls}`}>{statusBadge.label}</span>
      </td>
      <td className="py-2 text-right text-xs text-muted-foreground tabular-nums">
        {new Date(row.createdAt).toLocaleString()}
      </td>
    </>
  );
}
