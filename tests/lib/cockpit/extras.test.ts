import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  cockpitContent: {
    findMany: vi.fn(),
  },
  contentAnalysis: {
    findMany: vi.fn(),
  },
  platformAccount: {
    findFirst: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  actualMetric: {
    findMany: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { loadExtras } from '@/lib/cockpit/extras';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.platformAccount.findFirst.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.actualMetric.findMany.mockResolvedValue([]);
});

describe('loadExtras', () => {
  it('无 analysisId 的内容 → 空 predictions, 不查询 analysis', async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([]);

    const result = await loadExtras('user1');

    expect(result).toEqual({
      predictions: {},
      account: null,
      settings: { baselinePlays: null, retroMedian: null, retroCount: 0 },
    });
    expect(prismaMock.contentAnalysis.findMany).not.toHaveBeenCalled();
  });

  it('有预测区间 + 有 ActualMetric → 完整 entry', async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([
      { id: 'content-1', analysisId: 'analysis-1' },
    ]);
    prismaMock.contentAnalysis.findMany.mockResolvedValue([
      {
        id: 'analysis-1',
        report: { predictedPlaysRange: { predicted: 5000, lower: 3000, upper: 8000 } },
        actualMetrics: [{ plays: 6200n }],
      },
    ]);

    const result = await loadExtras('user1');

    expect(result.predictions).toEqual({
      'content-1': { predicted: 5000, lower: 3000, upper: 8000, actualPlays: 6200 },
    });
  });

  it('report 里没有合法 predictedPlaysRange → 该条目省略', async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([
      { id: 'content-1', analysisId: 'analysis-1' },
    ]);
    prismaMock.contentAnalysis.findMany.mockResolvedValue([
      { id: 'analysis-1', report: { overallScore: 70 }, actualMetrics: [] },
    ]);

    const result = await loadExtras('user1');

    expect(result.predictions).toEqual({});
  });

  it('没有 ActualMetric → actualPlays 为 null, 但预测区间仍返回', async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([
      { id: 'content-1', analysisId: 'analysis-1' },
    ]);
    prismaMock.contentAnalysis.findMany.mockResolvedValue([
      {
        id: 'analysis-1',
        report: { predictedPlaysRange: { predicted: 5000, lower: 3000, upper: 8000 } },
        actualMetrics: [],
      },
    ]);

    const result = await loadExtras('user1');

    expect(result.predictions).toEqual({
      'content-1': { predicted: 5000, lower: 3000, upper: 8000, actualPlays: null },
    });
  });

  it('无绑定账号 → account: null, 不查询 user.lastAutoSyncAt', async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([]);
    prismaMock.platformAccount.findFirst.mockResolvedValue(null);

    const result = await loadExtras('user1');

    expect(result.account).toBeNull();
  });

  it('已绑定账号 → account 取 nickname/loginStatus/followerCount/lastSyncAt + user.lastAutoSyncAt', async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([]);
    prismaMock.platformAccount.findFirst.mockResolvedValue({
      nickname: '测试号',
      loginStatus: 'EXPIRED',
      followerCount: 999,
      lastSyncAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    prismaMock.user.findUnique.mockResolvedValue({
      lastAutoSyncAt: new Date('2026-08-02T00:00:00.000Z'),
    });

    const result = await loadExtras('user1');

    expect(result.account).toEqual({
      nickname: '测试号',
      loginStatus: 'EXPIRED',
      followerCount: 999,
      lastSyncAt: '2026-08-01T00:00:00.000Z',
      lastAutoSyncAt: '2026-08-02T00:00:00.000Z',
    });
    expect(prismaMock.platformAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user1', isActive: true } }),
    );
  });

  it('settings: baselinePlays + retroCount < 3 → retroMedian null', async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([]);
    prismaMock.user.findUnique.mockResolvedValue({ baselinePlays: 500n });
    prismaMock.actualMetric.findMany.mockResolvedValue([{ plays: 100n }]);

    const result = await loadExtras('user1');

    expect(result.settings).toEqual({ baselinePlays: '500', retroMedian: null, retroCount: 1 });
  });
});
