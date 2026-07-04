import Link from 'next/link';
import { Suspense } from 'react';
import { ScriptForm } from '@/components/content/script-form';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { readInspirationInsight } from '@/lib/json-readers';

export const dynamic = 'force-dynamic';

interface LatestRec {
  title: string;
  rationale: string;
}

interface OnboardingState {
  latest: { id: string; recommended: LatestRec[] } | null;
  hasInspirationVideos: boolean;
  hasScripts: boolean;
  loadFailed: boolean;
}

async function getOnboardingState(): Promise<OnboardingState> {
  try {
    const user = await getOrCreateDefaultUser();
    const [insight, videoCount, scriptCount] = await Promise.all([
      prisma.inspirationInsight.findFirst({
        where: { userId: user.id },
        orderBy: { generatedAt: 'desc' },
        select: { id: true, output: true },
      }),
      prisma.inspirationVideo.count({ where: { userId: user.id } }),
      prisma.scriptDraft.count({ where: { userId: user.id } }),
    ]);
    const out = insight ? readInspirationInsight(insight.output) : null;
    return {
      latest: insight
        ? {
            id: insight.id,
            recommended: out?.recommendedTopics?.slice(0, 4) ?? [],
          }
        : null,
      hasInspirationVideos: videoCount > 0,
      hasScripts: scriptCount > 0,
      loadFailed: false,
    };
  } catch (err) {
    // 之前静默 return 默认值会让老用户误看到"👋 第一次来"引导。
    // 现在把失败标出来, 首屏可以显式提示 "加载失败" 而不是伪装成新用户。
    console.error('[/agent getOnboardingState] failed', err);
    return {
      latest: null,
      hasInspirationVideos: false,
      hasScripts: false,
      loadFailed: true,
    };
  }
}

export default async function AgentPage() {
  const { latest, hasInspirationVideos, hasScripts, loadFailed } = await getOnboardingState();
  const recommended = latest?.recommended ?? [];
  // loadFailed 时不显示 first-time 引导, 避免老用户被误引导
  const isFirstTime = !loadFailed && !hasInspirationVideos && !hasScripts && !latest;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">🪄 AI 自媒体智能体</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          选平台 → 选垂类 → 输 topic, 一次生成 platform-ready 内容,复制粘贴去发。
        </p>
      </div>

      {loadFailed && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          ⚠️ 载入状态失败, 部分个性化(最近选题推荐 / 新手引导)可能缺失。 功能本身可用, 请稍后刷新。
        </div>
      )}

      {isFirstTime && (
        <div className="rounded-xl border-2 border-dashed border-purple-300 bg-purple-50/40 p-5">
          <p className="text-base font-semibold text-purple-900">👋 第一次来? 没选题灵感? 一键搞定:</p>
          <ol className="mt-3 space-y-2 text-sm text-purple-900">
            <li>
              <span className="font-medium">1. AI 想 topic</span> 点 [主题发现], 选 niche → 系统给 12 个可立刻上手的选题候选
              (零输入, 不用提供链接素材)
            </li>
            <li>
              <span className="font-medium">2. 一键生成脚本</span> 看到中意的 topic → 点 [用这个生成], 跳本页自动出 4 区块 platform-ready 脚本
            </li>
            <li>
              <span className="font-medium">3. (可选) 收集对标</span> 想做 [借鉴爆款风格]?
              去 [灵感库] 粘对标 URL → AI 总结共性 → 风格透传到下次生成
            </li>
          </ol>
          <Link
            href="/agent/discover"
            className="mt-4 inline-block rounded-md bg-brand-gradient px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
          >
            🎯 让 AI 给我 12 个选题 →
          </Link>
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
