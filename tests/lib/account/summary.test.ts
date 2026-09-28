import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { buildAccountSummary } from '@/lib/account/summary';
import type { CollectStatus } from '@/lib/douyin/collect-log';

const collect: CollectStatus = { state: 'ok', lastRun: null, lastSuccessAt: '2026-09-28T12:00:00.000Z', consecutiveFailures: 0, hint: '' };

type Metric = { currentCount: number; lastPeriodIncr: number; fetchedAt: Date };
function db(opts: { snapshot?: Record<string, unknown> | null; fans?: Metric | null; likes?: Metric | null; legacyFans?: Metric }) {
  const metrics: Record<string, Metric | null | undefined> = { profile_followers: opts.fans, profile_total_favorited: opts.likes, fans: opts.legacyFans };
  return {
    benchmarkVideo: { count: async () => 2 },
    douyinMetricSummary: { findUnique: async ({ where }: { where: { metric: string } }) => metrics[where.metric] ?? null },
    douyinOverviewSnapshot: { findFirst: async () => opts.snapshot ?? null },
    publishedWork: {
      count: async ({ where }: { where?: { isPrivate?: boolean } } = {}) => (where?.isPrivate === false ? 5 : 101),
      aggregate: async ({ where }: { where?: { isPrivate?: boolean } } = {}) =>
        where?.isPrivate === false
          ? { _sum: { play: 30000 }, _max: { publishedAt: new Date('2026-08-20T08:00:00Z') } }
          : { _sum: { play: 257890 }, _max: { publishedAt: new Date('2026-08-27T20:00:00Z') } },
    },
  } as unknown as PrismaClient;
}

describe('buildAccountSummary', () => {
  it('reports profile followers and likes, and public works only', async () => {
    const at = new Date('2026-09-28T12:00:00Z');
    const s = await buildAccountSummary(db({ fans: { currentCount: 408, lastPeriodIncr: 3, fetchedAt: at }, likes: { currentCount: 2453, lastPeriodIncr: 0, fetchedAt: at } }), collect, collect);
    expect(s).toMatchObject({ fans: 408, fansDelta: 3, likes: 2453, publicWorks: 5, publicPlay: 30000, lastPublishedAt: '2026-08-20T08:00:00.000Z', dataAt: '2026-09-28T12:00:00.000Z' });
    expect(s.hits24h).toBe(2);
  });
  it('never falls back to the creator-center "fans" metric (it is not the follower count)', async () => {
    const s = await buildAccountSummary(db({ legacyFans: { currentCount: 2847, lastPeriodIncr: -2, fetchedAt: new Date() } }), collect, collect);
    expect(s.fans).toBeNull();
    expect(s.likes).toBeNull();
  });
  it('gives null recent90 when there were no submissions in the window (not zeros)', async () => {
    const s = await buildAccountSummary(db({ snapshot: { submissionCount: 0, medianPlay: 0, completionRate5s: 0 } }), collect, collect);
    expect(s.recent90).toBeNull();
    expect(s.hasOverview).toBe(true);
    expect(s.fans).toBeNull();
  });
  it('says the overview is unknown (not zero) when it was never collected', async () => {
    const s = await buildAccountSummary(db({ snapshot: null }), collect, collect);
    expect(s.hasOverview).toBe(false);
  });
  it('keeps recent90 when there were submissions', async () => {
    const s = await buildAccountSummary(db({ snapshot: { submissionCount: 3, medianPlay: 812, completionRate5s: 0.31 } }), collect, collect);
    expect(s.recent90).toEqual({ submissionCount: 3, medianPlay: 812, completionRate5s: 0.31 });
  });
});
