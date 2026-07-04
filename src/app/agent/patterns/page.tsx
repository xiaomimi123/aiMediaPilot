import Link from 'next/link';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { Card, CardContent } from '@/components/ui/card';
import { isHookTypeOverlap } from '@/lib/patterns/hook-similarity';
import { readScriptDraftOutput } from '@/lib/json-readers';

export const dynamic = 'force-dynamic';

interface ScriptStats {
  total: number;
  last7d: number;
  last30d: number;
  byPlatform: Record<string, number>;
  byNiche: Array<{ niche: string; count: number }>;
  topicLenAvg: number;
  titleLenAvg: number | null;
  hookTypes: Array<{ type: string; count: number }>;
}

interface LatestInsight {
  hookTypes: string[];
  titlePatterns: string[];
  durationInsight: string;
  generatedAt: string;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

async function aggregate(): Promise<{ stats: ScriptStats; latest: LatestInsight | null }> {
  const user = await getOrCreateDefaultUser();
  const now = Date.now();
  const D7 = now - 7 * 86400_000;
  const D30 = now - 30 * 86400_000;

  const scripts = await prisma.scriptDraft.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { topic: true, niche: true, platform: true, output: true, createdAt: true },
    take: 500,
  });

  const byPlatform: Record<string, number> = {};
  const byNicheMap = new Map<string, number>();
  const titleLengths: number[] = [];
  const hookTypeMap = new Map<string, number>();
  let last7d = 0;
  let last30d = 0;

  for (const s of scripts) {
    byPlatform[s.platform] = (byPlatform[s.platform] ?? 0) + 1;
    byNicheMap.set(s.niche, (byNicheMap.get(s.niche) ?? 0) + 1);
    const t = s.createdAt.getTime();
    if (t >= D7) last7d++;
    if (t >= D30) last30d++;

    const out = readScriptDraftOutput(s.output);
    if (out?.titles) {
      for (const t of out.titles) {
        if (typeof t.text === 'string') titleLengths.push(t.text.length);
        if (typeof t.hookType === 'string') {
          hookTypeMap.set(t.hookType, (hookTypeMap.get(t.hookType) ?? 0) + 1);
        }
      }
    }
  }

  const byNiche = Array.from(byNicheMap.entries())
    .map(([niche, count]) => ({ niche, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const hookTypes = Array.from(hookTypeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const stats: ScriptStats = {
    total: scripts.length,
    last7d,
    last30d,
    byPlatform,
    byNiche,
    topicLenAvg: avg(scripts.map((s) => s.topic.length)),
    titleLenAvg: titleLengths.length > 0 ? avg(titleLengths) : null,
    hookTypes,
  };

  const insight = await prisma.inspirationInsight.findFirst({
    where: { userId: user.id },
    orderBy: { generatedAt: 'desc' },
    select: { output: true, generatedAt: true },
  });
  const out = insight?.output as
    | { hookTypes?: string[]; titlePatterns?: string[]; durationInsight?: string }
    | null;
  const latest: LatestInsight | null = insight
    ? {
        hookTypes: Array.isArray(out?.hookTypes) ? out!.hookTypes : [],
        titlePatterns: Array.isArray(out?.titlePatterns) ? out!.titlePatterns : [],
        durationInsight: typeof out?.durationInsight === 'string' ? out!.durationInsight : '',
        generatedAt: insight.generatedAt.toISOString(),
      }
    : null;

  return { stats, latest };
}

const PLATFORM_LABEL: Record<string, string> = {
  douyin: '🎬 抖音',
  xiaohongshu: '📕 小红书',
  gongzhonghao: '📰 公众号',
};

export default async function PatternsPage() {
  const { stats, latest } = await aggregate();

  if (stats.total < 3) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">📈 我的内容规律</h1>
        </div>
        <Card>
          <CardContent className="space-y-3 pt-6 text-center">
            <p className="text-base">需要 ≥ 3 条脚本才能看出规律</p>
            <p className="text-sm text-muted-foreground">
              你当前已生成 {stats.total} 条脚本。 多用 [智能体] 写几条,这里会自动聚合你的标题字数 /
              偏好钩子 / niche 分布等规律,并跟灵感库对照。
            </p>
            <Link href="/agent" className="text-sm text-blue-600 hover:underline">
              去写脚本 →
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">📈 我的内容规律</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          基于你最近 {stats.total} 条脚本的聚合规律。 看出风格趋势,跟灵感库对照差距。
        </p>
      </div>

      {/* 概览 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="脚本总数" value={String(stats.total)} />
        <StatCard label="近 7 天" value={String(stats.last7d)} hint="条" />
        <StatCard label="近 30 天" value={String(stats.last30d)} hint="条" />
        <StatCard label="主题平均字数" value={stats.topicLenAvg.toFixed(1)} hint="字" />
      </div>

      {/* 平台 + niche */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 pt-6">
            <h3 className="text-sm font-semibold">📊 平台分布</h3>
            {Object.entries(stats.byPlatform).map(([p, n]) => {
              const pct = Math.round((n / stats.total) * 100);
              return (
                <div key={p} className="flex items-center gap-2 text-sm">
                  <span className="w-20 shrink-0">{PLATFORM_LABEL[p] ?? p}</span>
                  <div className="flex-1 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-brand-gradient"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                    {n} · {pct}%
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-6">
            <h3 className="text-sm font-semibold">🏷️ Niche 分布 (top 5)</h3>
            {stats.byNiche.length === 0 ? (
              <p className="text-xs text-muted-foreground">—</p>
            ) : (
              stats.byNiche.map(({ niche, count }) => (
                <div key={niche} className="flex items-center justify-between text-sm">
                  <span className="truncate">{niche}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">× {count}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* 钩子 + 标题长度 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 pt-6">
            <h3 className="text-sm font-semibold">🎣 你常用的钩子类型 (top 5)</h3>
            {stats.hookTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground">脚本中暂无 hookType 字段</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {stats.hookTypes.map(({ type, count }) => (
                  <span
                    key={type}
                    className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-900"
                  >
                    {type} <span className="opacity-60">× {count}</span>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-6">
            <h3 className="text-sm font-semibold">✍️ 标题字数</h3>
            {stats.titleLenAvg === null ? (
              <p className="text-xs text-muted-foreground">脚本输出中暂无 titles 字段</p>
            ) : (
              <>
                <p className="text-2xl font-semibold tabular-nums">
                  {stats.titleLenAvg.toFixed(1)} <span className="text-base text-muted-foreground">字 / 标题</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  汇总所有脚本的所有候选标题
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 跟灵感库对照 */}
      {latest && (
        <Card className="border-purple-200 bg-purple-50/30">
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">🪞 跟灵感库对照</h3>
              <span className="text-xs text-muted-foreground">
                总结于 {new Date(latest.generatedAt).toLocaleDateString('zh-CN')}
              </span>
            </div>

            {latest.hookTypes.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">灵感库主流钩子</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {latest.hookTypes.slice(0, 5).map((h, i) => {
                    const overlap = stats.hookTypes.some((own) => isHookTypeOverlap(own.type, h));
                    return (
                      <span
                        key={i}
                        className={`rounded px-2 py-0.5 text-xs ${
                          overlap ? 'bg-green-100 text-green-900' : 'bg-purple-100 text-purple-900'
                        }`}
                        title={overlap ? '你也常用' : '你还没用过 — 可尝试'}
                      >
                        {h} {overlap ? '✓' : '↗'}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {latest.titlePatterns.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">灵感库标题模式</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {latest.titlePatterns.slice(0, 5).map((t, i) => (
                    <span
                      key={i}
                      className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-900"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {latest.durationInsight && (
              <p className="text-xs">
                <span className="text-muted-foreground">灵感库时长规律: </span>
                {latest.durationInsight}
              </p>
            )}

            <Link
              href="/agent/inspiration"
              className="inline-block text-xs text-blue-600 hover:underline"
            >
              查看完整灵感总结 →
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {value}
          {hint && <span className="ml-1 text-sm font-normal text-muted-foreground">{hint}</span>}
        </p>
      </CardContent>
    </Card>
  );
}
