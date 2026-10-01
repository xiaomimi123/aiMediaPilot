import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { dayKey, loadTrend, recordDailySnapshot } from '@/lib/account/daily';

function fakeDb(fans: number | null, likes: number | null, fetchedAt: Date = new Date(2026, 9, 1, 19)) {
  const rows = new Map<string, Record<string, unknown>>();
  const db = {
    douyinMetricSummary: { findUnique: async ({ where }: { where: { metric: string } }) => (/follow/i.test(where.metric) ? (fans === null ? null : { currentCount: fans, fetchedAt }) : likes === null ? null : { currentCount: likes, fetchedAt }) },
    publishedWork: { aggregate: async () => ({ _count: { _all: 5 }, _sum: { play: 32890 } }) },
    accountDailySnapshot: {
      findUnique: async ({ where }: { where: { day: string } }) => rows.get(where.day) ?? null,
      upsert: async ({ where, create, update }: { where: { day: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        rows.set(where.day, { ...(rows.get(where.day) ?? create), ...(rows.has(where.day) ? update : {}) });
      },
      findMany: async () => [...rows.values()].sort((a, b) => String(a.day).localeCompare(String(b.day))),
    },
  } as unknown as PrismaClient;
  return { db, rows };
}

describe('account daily snapshot', () => {
  it('keys by local date', () => {
    expect(dayKey(new Date(2026, 9, 1, 23, 30))).toBe('2026-10-01');
  });
  it('records fans, likes, works and views', async () => {
    const { db, rows } = fakeDb(410, 2452);
    await recordDailySnapshot(db, new Date(2026, 9, 1, 20));
    expect(rows.get('2026-10-01')).toMatchObject({ day: '2026-10-01', fans: 410, likes: 2452, works: 5, views: 32890 });
  });
  it('overwrites the same day but keeps known numbers', async () => {
    const a = fakeDb(410, 2452);
    await recordDailySnapshot(a.db, new Date(2026, 9, 1, 20));
    const b = { ...a, db: fakeDb(null, 2460).db };
    (b.db as unknown as { accountDailySnapshot: unknown }).accountDailySnapshot = (a.db as unknown as { accountDailySnapshot: unknown }).accountDailySnapshot;
    await recordDailySnapshot(b.db, new Date(2026, 9, 1, 22));
    expect(a.rows.size).toBe(1);
    expect(a.rows.get('2026-10-01')).toMatchObject({ fans: 410, likes: 2460 });
  });
  it('returns the last N days in order', async () => {
    const { db } = fakeDb(410, 2452);
    await recordDailySnapshot(db, new Date(2026, 8, 30, 20));
    await recordDailySnapshot(db, new Date(2026, 9, 1, 20));
    expect((await loadTrend(db, 7, new Date(2026, 9, 1, 21))).map((r) => r.day)).toEqual(['2026-09-30', '2026-10-01']);
  });
  it('does not record yesterday\'s fans under today when today\'s profile fetch failed', async () => {
    const { db, rows } = fakeDb(410, 2452, new Date(2026, 8, 30, 20));
    await recordDailySnapshot(db, new Date(2026, 9, 1, 20));
    const r = rows.get('2026-10-01')!;
    expect(r.fans).toBeUndefined();
    expect(r.likes).toBeUndefined();
    expect(r.works).toBe(5);
  });
});
