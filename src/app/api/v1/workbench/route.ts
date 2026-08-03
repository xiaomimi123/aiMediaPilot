import { ok } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { deriveStage, type PipelineStage } from '@/lib/pipeline/stage';
import type { ContentCard, WorkbenchData } from '@/lib/pipeline/types';

/** retro 触发点 = 发布后 3 天, 与 analyses/[id]/publish/route.ts 的 3 * 86400000 同源 */
const RETRO_TARGET_DAYS = 3;
const DAY_MS = 86400000;
const RETROED_TAKE = 10;

function retroCountdown(publishedAt: Date | null): number | null {
  if (!publishedAt) return null;
  const elapsed = (Date.now() - publishedAt.getTime()) / DAY_MS;
  return Math.max(0, Math.ceil(RETRO_TARGET_DAYS - elapsed));
}

export async function GET() {
  const user = await getOrCreateDefaultUser();

  // 一次拼装, 三条查询, 无 per-card 二次查询 (spec §6 N+1 教训)
  const [drafts, orphanAnalyses, pool] = await Promise.all([
    prisma.scriptDraft.findMany({
      where: { userId: user.id, archivedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, topic: true, platform: true, picked: true, createdAt: true,
        analysis: {
          select: { id: true, publishedAt: true, retroStatus: true, createdAt: true },
        },
        distributions: { select: { platform: true, publishedAt: true } },
      },
    }),
    prisma.contentAnalysis.findMany({
      where: { userId: user.id, fromScripts: { none: {} } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, draftTitle: true, videoFilename: true,
        publishedAt: true, retroStatus: true, createdAt: true,
      },
    }),
    prisma.topicIdea.findMany({
      where: { userId: user.id, status: 'POOL' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, title: true, note: true, source: true, createdAt: true },
    }),
  ]);

  const cards: ContentCard[] = [];

  for (const d of drafts) {
    const analysis = d.analysis
      ? { publishedAt: d.analysis.publishedAt, retroStatus: d.analysis.retroStatus }
      : null;
    const stage = deriveStage({ picked: d.picked, analysis, distributionCount: d.distributions.length });
    const latestDist = d.distributions.reduce<Date | null>(
      (acc, x) => (acc && acc > x.publishedAt ? acc : x.publishedAt),
      null,
    );
    const publishedAt = d.analysis?.publishedAt ?? latestDist;
    const stageSince =
      stage === 'PUBLISHED' || stage === 'RETROED'
        ? publishedAt ?? d.createdAt
        : stage === 'SHOT'
          ? d.analysis?.createdAt ?? d.createdAt
          : d.createdAt;
    cards.push({
      id: d.id,
      kind: 'script',
      title: d.topic,
      platform: d.platform,
      stage,
      stageSince: stageSince.toISOString(),
      distributionCount: d.distributions.length,
      distributionPlatforms: [...new Set(d.distributions.map((x) => x.platform))],
      retroCountdownDays: stage === 'PUBLISHED' ? retroCountdown(publishedAt) : null,
      detailUrl: `/content/script/${d.id}`,
    });
  }

  for (const a of orphanAnalyses) {
    const stage = deriveStage({
      picked: null,
      analysis: { publishedAt: a.publishedAt, retroStatus: a.retroStatus },
      distributionCount: 0,
    });
    cards.push({
      id: a.id,
      kind: 'analysis',
      title: a.draftTitle ?? a.videoFilename,
      platform: 'douyin',
      stage,
      stageSince: (stage === 'PUBLISHED' || stage === 'RETROED' ? a.publishedAt ?? a.createdAt : a.createdAt).toISOString(),
      distributionCount: 0,
      distributionPlatforms: [],
      retroCountdownDays: stage === 'PUBLISHED' ? retroCountdown(a.publishedAt) : null,
      detailUrl: `/content/preflight/${a.id}`,
    });
  }

  const byStage = (s: PipelineStage) => cards.filter((c) => c.stage === s);
  const retroedAll = byStage('RETROED');
  const retroedRecent = [...retroedAll].sort(
    (a, b) => new Date(b.stageSince).getTime() - new Date(a.stageSince).getTime(),
  );

  const data: WorkbenchData = {
    counts: {
      pool: pool.length,
      drafting: byStage('DRAFTING').length,
      ready: byStage('READY').length,
      shot: byStage('SHOT').length,
      published: byStage('PUBLISHED').length,
      retroed: retroedAll.length,
    },
    topicPool: pool.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    columns: {
      drafting: byStage('DRAFTING'),
      ready: byStage('READY'),
      shot: byStage('SHOT'),
      published: byStage('PUBLISHED'),
      retroed: retroedRecent.slice(0, RETROED_TAKE), // 只显示最近若干条 (spec §3.2) — 按 stageSince 排序
    },
  };
  return ok(data);
}
