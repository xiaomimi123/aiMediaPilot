import Link from 'next/link';
import { Suspense } from 'react';
import { ScriptForm } from '@/components/content/script-form';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { readInspirationInsight } from '@/lib/json-readers';
import { PoolButton } from '@/components/workbench/pool-button';

export const dynamic = 'force-dynamic';

interface LatestRec {
  title: string;
  rationale: string;
}

interface LatestInsightState {
  latest: { id: string; recommended: LatestRec[] } | null;
  loadFailed: boolean;
}

async function getLatestInsight(): Promise<LatestInsightState> {
  try {
    const user = await getOrCreateDefaultUser();
    const insight = await prisma.inspirationInsight.findFirst({
      where: { userId: user.id },
      orderBy: { generatedAt: 'desc' },
      select: { id: true, output: true },
    });
    const out = insight ? readInspirationInsight(insight.output) : null;
    return {
      latest: insight
        ? {
            id: insight.id,
            recommended: out?.recommendedTopics?.slice(0, 4) ?? [],
          }
        : null,
      loadFailed: false,
    };
  } catch (err) {
    console.error('[/agent getLatestInsight] failed', err);
    return { latest: null, loadFailed: true };
  }
}

export default async function AgentPage() {
  const { latest, loadFailed } = await getLatestInsight();
  const recommended = latest?.recommended ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">🪄 创作</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          选平台 → 选垂类 → 输 topic, 一次生成 platform-ready 内容,复制粘贴去发。
        </p>
      </div>

      {loadFailed && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          ⚠️ 载入状态失败, 部分个性化(最近选题推荐)可能缺失。 功能本身可用, 请稍后刷新。
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Link
          href="/agent/discover"
          className="block rounded-xl border-2 border-pink-300 bg-gradient-to-br from-pink-50 to-purple-50 p-4 transition-all hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎯</span>
            <div className="flex-1">
              <p className="font-semibold">主题发现</p>
              <p className="text-xs text-muted-foreground">
                零输入 — AI 直接给 12 个选题, 含钩子/难度
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/agent/inspiration"
          className="block rounded-xl border border-purple-200 bg-purple-50/50 p-4 transition-colors hover:bg-purple-50"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">📚</span>
            <div className="flex-1">
              <p className="font-semibold">灵感视频库</p>
              <p className="text-xs text-muted-foreground">
                收对标爆款 → AI 总结共性 → 风格透传
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
                看你的标题字数 / 钩子偏好 / niche 分布
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
              <div
                key={i}
                className="flex items-center gap-1 rounded-full bg-white py-1 pl-3 pr-1.5 shadow-sm transition-shadow hover:shadow-md"
              >
                <Link
                  href={`/agent?topic=${encodeURIComponent(t.title)}&platform=douyin${latest ? `&inspirationId=${latest.id}` : ''}`}
                  className="text-xs text-blue-900 hover:underline"
                  title={t.rationale}
                >
                  {t.title}
                </Link>
                <PoolButton
                  title={t.title}
                  note={t.rationale}
                  source="inspiration"
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px] text-blue-700 hover:bg-blue-100 hover:text-blue-900"
                />
              </div>
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
