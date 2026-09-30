import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { saveWorkMetrics, localDay } from '@/lib/retro/metrics-store';
import type { WorkMetricRow } from '@/lib/retro/work-list';

const now = new Date('2026-09-29T12:00:00Z');
const m = (view: number) => ({ viewCount: view, likeCount: 1, commentCount: 0, shareCount: 0, favoriteCount: 0, subscribeCount: 0, homepageVisitCount: 0, completionRate: 0.1, completionRate5s: 0.5, bounceRate2s: 0.2, avgViewSec: 9, avgViewProportion: 0.3, fanViewProportion: 0, metricsUpdatedAt: null });

function fakeDb(works: { id: string; externalId: string; isPrivate: boolean; publishedAt: Date }[]) {
  const updates: string[] = [];
  const snaps = new Map<string, unknown>();
  const db = {
    publishedWork: {
      findMany: async () => works,
      update: async ({ where }: { where: { id: string } }) => {
        updates.push(where.id);
      },
    },
    workMetricSnapshot: {
      upsert: async ({ where, create }: { where: { workId_day: { workId: string; day: string } }; create: unknown }) => {
        snaps.set(`${where.workId_day.workId}:${where.workId_day.day}`, create);
      },
    },
  } as unknown as PrismaClient;
  return { db, updates, snaps };
}

const rows: WorkMetricRow[] = [
  { awemeId: 'recent', createTime: 0, metrics: m(100) },
  { awemeId: 'old', createTime: 0, metrics: m(200) },
  { awemeId: 'private', createTime: 0, metrics: m(0) },
  { awemeId: 'unknown', createTime: 0, metrics: m(5) },
];
const works = [
  { id: 'w1', externalId: 'recent', isPrivate: false, publishedAt: new Date('2026-09-25T00:00:00Z') },
  { id: 'w2', externalId: 'old', isPrivate: false, publishedAt: new Date('2026-05-08T00:00:00Z') },
  { id: 'w3', externalId: 'private', isPrivate: true, publishedAt: new Date('2026-09-25T00:00:00Z') },
];

describe('saveWorkMetrics', () => {
  it('updates known works and snapshots only recent public ones', async () => {
    const { db, updates, snaps } = fakeDb(works);
    expect(await saveWorkMetrics(db, rows, now)).toEqual({ updated: 3, snapshots: 1 });
    expect(updates).toEqual(['w1', 'w2', 'w3']);
    expect([...snaps.keys()]).toEqual([`w1:${localDay(now)}`]);
  });
  it('overwrites the same day snapshot', async () => {
    const { db, snaps } = fakeDb(works);
    await saveWorkMetrics(db, rows, now);
    await saveWorkMetrics(db, rows, new Date(now.getTime() + 3600_000));
    expect(snaps.size).toBe(1);
  });
  it('uses the Shanghai calendar day', () => {
    expect(localDay(new Date('2026-09-29T17:00:00Z'))).toBe('2026-09-30');
  });
});
