import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  contentAnalysis: {
    count: vi.fn(),
    aggregate: vi.fn(),
    findMany: vi.fn(),
  },
  actualMetric: {
    findMany: vi.fn(),
  },
  scriptDraft: {
    count: vi.fn(),
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
  prismaMock.actualMetric.findMany.mockResolvedValue([]);
  prismaMock.scriptDraft.count.mockResolvedValue(0);
  // $queryRaw 现在两次: 首个 promise-all 里的 niche groupBy, 之后独立的 totalSpend
  prismaMock.$queryRaw.mockResolvedValue([]);
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
    // $queryRaw 顺序: (1) Promise.all 内的 niche 分组, (2) 之后的 totalSpend
    prismaMock.$queryRaw
      .mockResolvedValueOnce([
        { niche: 'ai-knowledge', count: 5, avg: 72 },
        { niche: 'custom-fitness', count: 2, avg: 60 },
      ])
      .mockResolvedValueOnce([{ total: 0 }]);
    const result = await aggregateDashboard('user1');
    expect(result.nicheDistribution[0].label).toBe('AI 知识');
    expect(result.nicheDistribution[0].count).toBe(5);
    expect(result.nicheDistribution[0].avgOverallScore).toBe(72);
    expect(result.nicheDistribution[1].label).toBe('custom-fitness');
  });

  it('predictionAccuracy: 1 in-range + 1 over 时正确 (有 prediction 和 retro)', async () => {
    prismaMock.contentAnalysis.findMany
      .mockResolvedValueOnce([])  // trendRows
      .mockResolvedValueOnce([])  // retroSourceRows
      .mockResolvedValueOnce([])  // missCandidateRows
      .mockResolvedValueOnce([    // predictionAccuracyRows
        {
          id: 'a-in',
          videoFilename: 'in.mp4',
          completedAt: new Date('2026-06-10T00:00:00Z'),
          report: { predictedPlaysRange: { predicted: 1000, lower: 500, upper: 2000 } },
          actualMetrics: [{ plays: 1200n }],
        },
        {
          id: 'a-over',
          videoFilename: 'over.mp4',
          completedAt: new Date('2026-06-09T00:00:00Z'),
          report: { predictedPlaysRange: { predicted: 2000, lower: 1000, upper: 4000 } },
          actualMetrics: [{ plays: 500n }],
        },
      ]);
    const result = await aggregateDashboard('user1');
    expect(result.predictionAccuracy).not.toBeNull();
    expect(result.predictionAccuracy!.totalSamples).toBe(2);
    expect(result.predictionAccuracy!.inRangeCount).toBe(1);
    expect(result.predictionAccuracy!.overCount).toBe(1);
    expect(result.predictionAccuracy!.underCount).toBe(0);
    expect(result.predictionAccuracy!.recent).toHaveLength(2);
    expect(result.predictionAccuracy!.recent[0].id).toBe('a-in');
  });

  it('predictionAccuracy=null 当无 prediction-retro 配对', async () => {
    prismaMock.contentAnalysis.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'a-no-retro',
          videoFilename: 'x.mp4',
          completedAt: new Date(),
          report: { predictedPlaysRange: { predicted: 1000, lower: 500, upper: 2000 } },
          actualMetrics: [],
        },
      ]);
    const result = await aggregateDashboard('user1');
    expect(result.predictionAccuracy).toBeNull();
  });

  it('workflowQueue 返回 3 counts (unpublishedAnalyses / awaitingRetro / savedScripts)', async () => {
    // Counts 4, 5, 6 are workflow queries (after main 3 counts).
    // mockResolvedValueOnce chain — fall through default 0 for first 3 main counts.
    prismaMock.contentAnalysis.count
      .mockResolvedValueOnce(0)  // totalAnalyses
      .mockResolvedValueOnce(0)  // last7dCount
      .mockResolvedValueOnce(0)  // retroedCount
      .mockResolvedValueOnce(3)  // unpublishedAnalyses
      .mockResolvedValueOnce(2); // awaitingRetro
    prismaMock.scriptDraft.count.mockResolvedValueOnce(7);
    const result = await aggregateDashboard('user1');
    expect(result.workflowQueue).toEqual({
      unpublishedAnalyses: 3,
      awaitingRetro: 2,
      savedScripts: 7,
    });
  });

  it('workflowQueue 全 0 时 仍返回 0 三元', async () => {
    const result = await aggregateDashboard('user1');
    expect(result.workflowQueue).toEqual({
      unpublishedAnalyses: 0,
      awaitingRetro: 0,
      savedScripts: 0,
    });
  });
});
