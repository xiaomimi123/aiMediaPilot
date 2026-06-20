import Link from 'next/link';
import { Suspense } from 'react';
import { ScriptForm } from '@/components/content/script-form';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface LatestRec {
  title: string;
  rationale: string;
}

async function getLatestInsight(): Promise<{ id: string; recommended: LatestRec[] } | null> {
  try {
    const user = await getOrCreateDefaultUser();
    const latest = await prisma.inspirationInsight.findFirst({
      where: { userId: user.id },
      orderBy: { generatedAt: 'desc' },
      select: { id: true, output: true },
    });
    if (!latest) return null;
    const out = latest.output as { recommendedTopics?: LatestRec[] } | null;
    return {
      id: latest.id,
      recommended: Array.isArray(out?.recommendedTopics) ? out!.recommendedTopics.slice(0, 4) : [],
    };
  } catch {
    return null;
  }
}

export default async function AgentPage() {
  const latest = await getLatestInsight();
  const recommended = latest?.recommended ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">🪄 AI 自媒体智能体</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          选平台 → 选垂类 → 输 topic, 一次生成 platform-ready 内容,复制粘贴去发。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Link
          href="/agent/inspiration"
          className="block rounded-xl border border-purple-200 bg-purple-50/50 p-4 transition-colors hover:bg-purple-50"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">📚</span>
            <div className="flex-1">
              <p className="font-semibold">灵感视频库</p>
              <p className="text-xs text-muted-foreground">
                收集对标爆款 → AI 总结共性 → 推荐 topic
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/agent/patterns"
          className="block rounded-xl border border-blue-200 bg-blue-50/50 p-4 transition-colors hover:bg-blue-50"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">📈</span>
            <div className="flex-1">
              <p className="font-semibold">我的内容规律</p>
              <p className="text-xs text-muted-foreground">
                看你的标题字数 / 钩子偏好 / niche 分布,跟灵感库对照
              </p>
            </div>
          </div>
        </Link>
      </div>

      {recommended.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-blue-900">
              💡 最近灵感推荐的 topic
            </p>
            <Link
              href="/agent/inspiration"
              className="text-xs text-blue-700 hover:underline"
            >
              管理 →
            </Link>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recommended.map((t, i) => (
              <Link
                key={i}
                href={`/agent?topic=${encodeURIComponent(t.title)}&platform=douyin${latest ? `&inspirationId=${latest.id}` : ''}`}
                className="rounded-full bg-white px-3 py-1 text-xs text-blue-900 shadow-sm transition-shadow hover:shadow-md"
                title={t.rationale}
              >
                {t.title}
              </Link>
            ))}
          </div>
        </div>
      )}

      <Suspense fallback={<div className="text-sm text-muted-foreground">加载中…</div>}>
        <ScriptForm />
      </Suspense>
    </div>
  );
}
