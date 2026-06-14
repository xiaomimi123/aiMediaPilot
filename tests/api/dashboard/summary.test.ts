import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

vi.mock('@/lib/dashboard/aggregate', () => ({
  aggregateDashboard: vi.fn(async (_userId: string) => ({
    stats: { totalAnalyses: 5, totalSpendUSD: 0.42, last7dCount: 2, retroedCount: 3 },
    trend: [],
    calibration: null,
    nicheDistribution: [],
    topPerformers: [],
    biggestMisses: [],
  })),
}));

import { GET } from '@/app/api/v1/dashboard/summary/route';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/v1/dashboard/summary', () => {
  it('返回 DashboardSummary', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.stats.totalAnalyses).toBe(5);
  });

  it('aggregate 抛错 → 500', async () => {
    const { aggregateDashboard } = await import('@/lib/dashboard/aggregate');
    (aggregateDashboard as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'));
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/db down|失败/);
  });
});
