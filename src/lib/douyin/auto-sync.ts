import { prisma } from '@/lib/prisma';
import { retroQueue } from '@/jobs/queue';
import { runDouyinListAdapter } from './list';
import { bigramDice, filenameBasename } from './fuzzy';
import { parseLooseBeijingTime } from './parse-time';
import { dateISOInShanghai, todayISO } from '@/lib/cockpit/calculations';
import { bumpCockpitRev } from '@/lib/cockpit/server-store';

const MATCH_THRESHOLD = 0.8;

export interface AutoSyncStats {
  itemCount: number;
  matchedCount: number;
  skippedAlreadyMatched: number;
  skippedLowConfidence: number;
}

export async function runAutoSync(userId: string): Promise<AutoSyncStats> {
  const items = await runDouyinListAdapter();
  const stats: AutoSyncStats = {
    itemCount: items.length,
    matchedCount: 0,
    skippedAlreadyMatched: 0,
    skippedLowConfidence: 0,
  };

  if (items.length === 0) return stats;

  const unmatched = await prisma.contentAnalysis.findMany({
    where: { userId, status: 'COMPLETED', douyinAwemeId: null },
    select: { id: true, videoFilename: true, draftTitle: true },
  });

  for (const item of items) {
    const existing = await prisma.contentAnalysis.findFirst({
      where: { douyinAwemeId: item.awemeId },
      select: { id: true },
    });
    if (existing) {
      stats.skippedAlreadyMatched++;
      continue;
    }

    const scored = unmatched.map((a) => {
      const titleSrc = a.draftTitle ?? filenameBasename(a.videoFilename);
      return { analysisId: a.id, score: bigramDice(titleSrc, item.desc) };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (best && best.score >= MATCH_THRESHOLD) {
      const publishedAt = parseLooseBeijingTime(item.postedAt) ?? new Date();
      await prisma.contentAnalysis.update({
        where: { id: best.analysisId },
        data: {
          douyinAwemeId: item.awemeId,
          douyinUrl: `https://www.douyin.com/video/${item.awemeId}`,
          publishedAt,
          retroStatus: 'SCHEDULED',
        },
      });

      // 回填关联的 cockpit content(若存在且仍处于制作阶段)— best-effort, 不阻塞主流程
      try {
        await prisma.cockpitContent.updateMany({
          where: {
            analysisId: best.analysisId,
            userId,
            stage: { in: ['recording', 'editing', 'publishing'] },
          },
          data: {
            publicationStatus: 'published',
            publishedAt: dateISOInShanghai(publishedAt),
            stage: 'review',
            updatedAt: todayISO(),
          },
        });
        // 敲一下 prefs.updatedAt, 让打开的标签页 rev 失效, 避免下次整页保存覆盖此回填
        await bumpCockpitRev(userId);
      } catch (e) {
        console.warn('[cockpit-backfill]', e);
      }

      await retroQueue.add(
        'retro',
        { analysisId: best.analysisId },
        {
          jobId: `retro-${best.analysisId}`,
          delay: 0,
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 3600, count: 100 },
        },
      );
      const idx = unmatched.findIndex((a) => a.id === best.analysisId);
      if (idx >= 0) unmatched.splice(idx, 1);
      stats.matchedCount++;
      console.log(
        `[auto-sync] matched aweme ${item.awemeId} → analysis ${best.analysisId} (score ${best.score.toFixed(2)})`,
      );
    } else {
      stats.skippedLowConfidence++;
      console.log(
        `[auto-sync] no match for aweme ${item.awemeId} (best score ${best?.score.toFixed(2) ?? 'N/A'})`,
      );
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { lastAutoSyncAt: new Date() },
  });

  return stats;
}
