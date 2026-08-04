import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { RETRO: 'content-retro' } }));

const prismaMock = vi.hoisted(() => ({
  contentAnalysis: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  actualMetric: { create: vi.fn(async (args: any) => ({ id: 'm1', ...args.data })) },
  cockpitContent: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.mock('@/lib/douyin/adapter', () => ({
  probeDouyinCookie: vi.fn(async () => true),
  runDouyinAdapter: vi.fn(async () => '/tmp/report.md'),
}));

vi.mock('@/lib/douyin/report-parser', () => ({
  parseReportMd: vi.fn(async () => ({
    plays: 12345n, likes: 1234n, comments: 234n, shares: 45n, collects: 123n,
    completionRateBp: 3210, retention3sBp: 6540, followConversionBp: 120,
    likeRateBp: 999, commentRateBp: 189, shareRateBp: 36, topComments: null,
  })),
}));

const llmCallMock = vi.fn();
vi.mock('@/lib/llm/vision', () => ({
  OpenAIVisionLLM: class { callStructured = llmCallMock; },
}));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: class { callStructured = llmCallMock; },
}));

import { runRetroPipeline } from '@/jobs/workers/content-retro-worker';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'sk-test';
  delete process.env.DEEPSEEK_API_KEY;  // 强制走 OpenAI 路径,避免 dev .env 影响测试
  prismaMock.contentAnalysis.findUnique.mockResolvedValue({
    id: 'a1',
    userId: 'user1',
    douyinAwemeId: '7234567890',
    publishedAt: new Date(Date.now() - 3 * 86400000),
    retroStatus: 'SCHEDULED',
    report: { hook: { rating: 3 }, retention: { riskPoints: [] }, titleCaption: { mode: 'evaluate' }, cover: { mode: 'generate' } },
    llmUsage: { total: { promptTokens: 1000, completionTokens: 100, estCostUSD: 0.01, model: 'aggregate' }, byCall: [] },
  });
  prismaMock.cockpitContent.findFirst.mockResolvedValue(null);
  prismaMock.cockpitContent.update.mockResolvedValue({});
  prismaMock.cockpitContent.updateMany.mockResolvedValue({ count: 0 });
  llmCallMock.mockResolvedValue({
    result: {
      schemaVersion: 1, niche: 'ai-knowledge',
      hookGap: { predictedRating: 3, relevantActual: { retention3sBp: 6540 }, takeaway: 'x', accuracy: 'on-target' },
      retentionGap: { predictedRiskPoints: 0, relevantActual: { completionRateBp: 3210 }, takeaway: 'x', accuracy: 'on-target' },
      titleCaptionGap: { mode: 'evaluate', relevantActual: {}, takeaway: 'x', accuracy: 'on-target' },
      coverGap: { mode: 'generate', relevantActual: { plays: 12345 }, takeaway: 'x', accuracy: 'on-target' },
      overallTakeaway: 'ok',
      predictedOverallScore: 78,
      inferredActualScore: 70,
    },
    usage: { model: 'gpt-4o-mini', promptTokens: 500, completionTokens: 200, estCostUSD: 0.005 },
  });
});

describe('runRetroPipeline', () => {
  it('happy path: cookie OK + fetch + parse + create + LLM + updateMany', async () => {
    await runRetroPipeline('a1');
    expect(prismaMock.actualMetric.create).toHaveBeenCalled();
    expect(llmCallMock).toHaveBeenCalled();
    expect(prismaMock.contentAnalysis.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1', retroStatus: { not: 'CANCELLED' } },
        data: expect.objectContaining({ retroStatus: 'COMPLETED' }),
      })
    );
  });

  it('关联 cockpit content 存在 → metrics 回填 (保留 followerGain) + retroStatus COMPLETED 后 stage=review → archived', async () => {
    prismaMock.cockpitContent.findFirst.mockResolvedValueOnce({
      id: 'c1',
      metrics: { views: 0, likes: 0, saves: 0, comments: 0, followerGain: 42, capturedAt: '' },
    });
    await runRetroPipeline('a1');
    expect(prismaMock.cockpitContent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { analysisId: 'a1', userId: 'user1' } }),
    );
    expect(prismaMock.cockpitContent.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        metrics: expect.objectContaining({
          views: 12345,
          likes: 1234,
          saves: 123,
          comments: 234,
          followerGain: 42,
        }),
      }),
    });
    expect(prismaMock.cockpitContent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { analysisId: 'a1', userId: 'user1', stage: 'review' },
        data: expect.objectContaining({ stage: 'archived' }),
      }),
    );
  });

  it('无关联 cockpit content (findFirst 返回 null) → 不调 cockpitContent.update (metrics 回填跳过)', async () => {
    await runRetroPipeline('a1');
    expect(prismaMock.cockpitContent.update).not.toHaveBeenCalled();
  });

  it('cockpit metrics 回填 findFirst 抛错 → 不阻断主流程 (ActualMetric/最终 updateMany 仍执行)', async () => {
    prismaMock.cockpitContent.findFirst.mockRejectedValueOnce(new Error('db down'));
    await runRetroPipeline('a1');
    expect(prismaMock.actualMetric.create).toHaveBeenCalled();
    expect(prismaMock.contentAnalysis.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retroStatus: 'COMPLETED' }) }),
    );
  });

  it('最终 updateMany count=0 (被 CANCELLED race 抢先) → 不触发 cockpit 归档', async () => {
    prismaMock.contentAnalysis.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.cockpitContent.findFirst.mockResolvedValueOnce({
      id: 'c1',
      metrics: { views: 0, likes: 0, saves: 0, comments: 0, followerGain: 0, capturedAt: '' },
    });
    await runRetroPipeline('a1');
    expect(prismaMock.cockpitContent.updateMany).not.toHaveBeenCalled();
  });

  it('cookie 失效 → retroStatus=FAILED, 不调 adapter', async () => {
    const { probeDouyinCookie } = await import('@/lib/douyin/adapter');
    (probeDouyinCookie as any).mockResolvedValueOnce(false);
    await runRetroPipeline('a1');
    expect(prismaMock.contentAnalysis.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ retroStatus: 'FAILED', retroErrorMessage: expect.stringMatching(/cookie/) }),
      })
    );
    expect(prismaMock.actualMetric.create).not.toHaveBeenCalled();
  });

  it('AI 失败 fail-soft: ActualMetric 仍写入, retroStatus 仍 COMPLETED, retroReport=null', async () => {
    llmCallMock.mockRejectedValueOnce(new Error('llm broken'));
    await runRetroPipeline('a1');
    expect(prismaMock.actualMetric.create).toHaveBeenCalled();
    expect(prismaMock.contentAnalysis.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ retroStatus: 'COMPLETED' }),
      })
    );
  });

  it('analysis 不存在 → 早退, 无任何 update', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce(null);
    await runRetroPipeline('a1');
    expect(prismaMock.contentAnalysis.update).not.toHaveBeenCalled();
    expect(prismaMock.actualMetric.create).not.toHaveBeenCalled();
  });

  it('retroStatus=CANCELLED → 早退', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({
      id: 'a1',
      douyinAwemeId: '7234567890',
      publishedAt: new Date(Date.now() - 3 * 86400000),
      retroStatus: 'CANCELLED',
      report: {},
      llmUsage: null,
    });
    await runRetroPipeline('a1');
    expect(prismaMock.actualMetric.create).not.toHaveBeenCalled();
  });

  it('analysis 缺 douyinAwemeId → 早退', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({
      id: 'a1',
      douyinAwemeId: null,
      publishedAt: new Date(Date.now() - 3 * 86400000),
      retroStatus: 'SCHEDULED',
      report: {},
      llmUsage: null,
    });
    await runRetroPipeline('a1');
    expect(prismaMock.contentAnalysis.update).not.toHaveBeenCalled();
    expect(prismaMock.actualMetric.create).not.toHaveBeenCalled();
  });

  it('runDouyinAdapter 抛错 → retroStatus=FAILED 且消息含"数据采集失败"', async () => {
    const { runDouyinAdapter } = await import('@/lib/douyin/adapter');
    (runDouyinAdapter as any).mockRejectedValueOnce(new Error('adapter exit 1'));
    await runRetroPipeline('a1');
    expect(prismaMock.contentAnalysis.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          retroStatus: 'FAILED',
          retroErrorMessage: expect.stringMatching(/数据采集失败/),
        }),
      })
    );
    expect(prismaMock.actualMetric.create).not.toHaveBeenCalled();
  });
});
