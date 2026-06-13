import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  contentAnalysis: {
    count: vi.fn(),
    aggregate: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  actualMetric: {
    findMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.mock('@/lib/llm/prompts/expert-persona', () => ({
  KNOWN_NICHES: [
    { key: 'ai-knowledge', label: 'AI 知识' },
    { key: 'entertainment', label: '娱乐 / 体育 / 影视' },
  ],
}));

import { aggregateDashboard } from '@/lib/dashboard/aggregate';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentAnalysis.count.mockResolvedValue(0);
  prismaMock.contentAnalysis.aggregate.mockResolvedValue({ _sum: {} });
  prismaMock.contentAnalysis.findMany.mockResolvedValue([]);
  prismaMock.contentAnalysis.groupBy.mockResolvedValue([]);
  prismaMock.actualMetric.findMany.mockResolvedValue([]);
  prismaMock.$queryRaw.mockResolvedValue([{ total: 0 }]);
});

describe('aggregateDashboard', () => {
  it('0 条返回 stats=0 + trend=[] + calibration=null', async () => {
    const result = await aggregateDashboard('user1');
    expect(result.stats.totalAnalyses).toBe(0);
    expect(result.trend).toEqual([]);
    expect(result.calibration).toBeNull();
  });

  it('< 3 retro 时 calibration=null', async () => {
    prismaMock.contentAnalysis.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    prismaMock.contentAnalysis.findMany
      .mockResolvedValueOnce([
        { id: 'a', videoFilename: 'x', completedAt: new Date(), report: { overallScore: 70 }, retroReport: null },
      ])
      .mockResolvedValueOnce([
        { retroReport: { hookGap: { accuracy: 'on-target' } } },
        { retroReport: { hookGap: { accuracy: 'on-target' } } },
      ])
      .mockResolvedValueOnce([]);
    const result = await aggregateDashboard('user1');
    expect(result.calibration).toBeNull();
  });

  it('3+ retro 时 calibration 不为 null', async () => {
    prismaMock.contentAnalysis.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    prismaMock.contentAnalysis.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { retroReport: { hookGap: { accuracy: 'on-target' }, retentionGap: { accuracy: 'over-estimated' }, titleCaptionGap: { accuracy: 'on-target' }, coverGap: { accuracy: 'on-target' } } },
        { retroReport: { hookGap: { accuracy: 'on-target' }, retentionGap: { accuracy: 'over-estimated' }, titleCaptionGap: { accuracy: 'on-target' }, coverGap: { accuracy: 'on-target' } } },
        { retroReport: { hookGap: { accuracy: 'on-target' }, retentionGap: { accuracy: 'on-target' }, titleCaptionGap: { accuracy: 'on-target' }, coverGap: { accuracy: 'on-target' } } },
      ])
      .mockResolvedValueOnce([]);
    const result = await aggregateDashboard('user1');
    expect(result.calibration).not.toBeNull();
    expect(result.calibration!.sampleCount).toBe(3);
  });

  it('plays (BigInt) 序列化为 string', async () => {
    prismaMock.actualMetric.findMany.mockResolvedValueOnce([
      { plays: 12345n, analysis: { id: 'a1', videoFilename: 'x.mp4', report: { overallScore: 75 } } },
    ]);
    const result = await aggregateDashboard('user1');
    expect(result.topPerformers[0].plays).toBe('12345');
    expect(typeof result.topPerformers[0].plays).toBe('string');
  });

  it('biggestMisses 按 predicted - inferred 倒序', async () => {
    prismaMock.contentAnalysis.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'a1', videoFilename: 'lo.mp4', retroReport: { predictedOverallScore: 90, inferredActualScore: 50 } },
        { id: 'a2', videoFilename: 'hi.mp4', retroReport: { predictedOverallScore: 60, inferredActualScore: 55 } },
        { id: 'a3', videoFilename: 'mid.mp4', retroReport: { predictedOverallScore: 80, inferredActualScore: 30 } },
      ]);
    const result = await aggregateDashboard('user1');
    expect(result.biggestMisses).toHaveLength(3);
    expect(result.biggestMisses[0].id).toBe('a3');
    expect(result.biggestMisses[0].gap).toBe(50);
    expect(result.biggestMisses[1].id).toBe('a1');
    expect(result.biggestMisses[2].id).toBe('a2');
  });

  it('niche label 来自 KNOWN_NICHES, 未知 niche 用原字符串', async () => {
    prismaMock.contentAnalysis.groupBy.mockResolvedValueOnce([
      { niche: 'ai-knowledge', _count: { _all: 5 } },
      { niche: 'custom-fitness', _count: { _all: 2 } },
    ]);
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ total: 0 }])  // totalSpendUSD
      .mockResolvedValueOnce([{ avg: 72 }])   // niche 1 avg
      .mockResolvedValueOnce([{ avg: 60 }]);  // niche 2 avg
    const result = await aggregateDashboard('user1');
    expect(result.nicheDistribution[0].label).toBe('AI 知识');
    expect(result.nicheDistribution[1].label).toBe('custom-fitness');
  });
});
