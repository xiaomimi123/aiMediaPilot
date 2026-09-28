import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { buildAccountSummary } from '@/lib/account/summary';
import type { CollectStatus } from '@/lib/douyin/collect-log';

const collect: CollectStatus = { state: 'ok', lastRun: null, lastSuccessAt: '2026-09-28T12:00:00.000Z', consecutiveFailures: 0, hint: '' };

function db(opts: { snapshot?: Record<string, unknown> | null; fans?: { currentCount: number; lastPeriodIncr: number; fetchedAt: Date } | null }) {
  return {
    douyinMetricSummary: { findUnique: async () => opts.fans ?? null },
    douyinOverviewSnapshot: { findFirst: async () => opts.snapshot ?? null },
    publishedWork: {
      count: async ({ where }: { where?: { isPrivate?: boolean } } = {}) => (where?.isPrivate === false ? 5 : 101),
      aggregate: async () => ({ _sum: { play: 257890 }, _max: { publishedAt: new Date('2026-08-20T08:00:00Z') } }),
    },
  } as unknown as PrismaClient;
}

describe('buildAccountSummary', () => {
  it('reports fans, works, plays and the latest publish date', async () => {
    const s = await buildAccountSummary(db({ fans: { currentCount: 2847, lastPeriodIncr: -2, fetchedAt: new Date('2026-09-26T18:50:00Z') } }), collect);
    expect(s).toMatchObject({ fans: 2847, fansDelta: -2, works: 101, publicWorks: 5, totalPlay: 257890, lastPublishedAt: '2026-08-20T08:00:00.000Z', dataAt: '2026-09-26T18:50:00.000Z' });
  });
  it('gives null recent90 when there were no submissions in the window (not zeros)', async () => {
    const s = await buildAccountSummary(db({ snapshot: { submissionCount: 0, medianPlay: 0, completionRate5s: 0 } }), collect);
    expect(s.recent90).toBeNull();
    expect(s.fans).toBeNull();
  });
  it('keeps recent90 when there were submissions', async () => {
    const s = await buildAccountSummary(db({ snapshot: { submissionCount: 3, medianPlay: 812, completionRate5s: 0.31 } }), collect);
    expect(s.recent90).toEqual({ submissionCount: 3, medianPlay: 812, completionRate5s: 0.31 });
  });
});
