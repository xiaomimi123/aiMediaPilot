import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RadarReadResponse } from '@/lib/llm/prompts/radar-read';
import type { SearchResult } from '@/lib/radar/search';

const configMock = vi.hoisted(() => ({
  getRadarConfig: vi.fn(),
  getDecryptedTavilyKey: vi.fn(),
}));
vi.mock('@/lib/radar/config', () => configMock);

const searchProviderMock = vi.hoisted(() => ({ search: vi.fn() }));
const getSearchProviderMock = vi.hoisted(() => vi.fn(() => searchProviderMock));
vi.mock('@/lib/radar/search', () => ({
  getSearchProvider: getSearchProviderMock,
}));

const llmCallMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: class {
    callStructured = llmCallMock;
  },
}));

const prismaMock = vi.hoisted(() => {
  const m: any = {
    radarKeyword: { findMany: vi.fn(), createMany: vi.fn() },
    radarRun: { create: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    radarItem: { findMany: vi.fn(), createMany: vi.fn() },
  };
  m.$transaction = vi.fn(async (cb: any) => cb(m));
  return m;
});
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { runRadarScan } from '@/lib/radar/run';

function searchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    url: 'https://a.example.com/1',
    title: '标题一',
    content: '正文内容',
    sourceSite: 'a.example.com',
    ...overrides,
  };
}

function readResult(overrides: Partial<RadarReadResponse> = {}): RadarReadResponse {
  return {
    summary: '摘要',
    angle: '切入角度',
    relevance: 80,
    freshness: 70,
    discussion: 60,
    feasibility: 75,
    suggestedKeywords: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEEPSEEK_API_KEY = 'ds-fake';

  configMock.getRadarConfig.mockResolvedValue({ hasKey: true, dailyLimit: 20, enabled: true });
  configMock.getDecryptedTavilyKey.mockResolvedValue('tvly-fake');

  prismaMock.radarKeyword.findMany.mockResolvedValue([
    { id: 'k1', userId: 'u1', text: 'AI 模型', status: 'active', source: 'manual' },
  ]);
  prismaMock.radarItem.findMany.mockResolvedValue([]);
  prismaMock.radarRun.create.mockImplementation(async ({ data }: any) => ({
    id: 'run1',
    startedAt: new Date(),
    ...data,
  }));
  prismaMock.radarRun.update.mockResolvedValue({});
  prismaMock.radarRun.aggregate.mockResolvedValue({ _sum: { read: 0 } });
  prismaMock.radarItem.createMany.mockResolvedValue({ count: 0 });
  prismaMock.radarKeyword.createMany.mockResolvedValue({ count: 0 });

  searchProviderMock.search.mockResolvedValue([]);
  llmCallMock.mockResolvedValue({ result: readResult(), usage: {} });
});

describe('runRadarScan', () => {
  it('未启用 (enabled=false) → 早退 null, 不创建 RadarRun', async () => {
    configMock.getRadarConfig.mockResolvedValue({ hasKey: true, dailyLimit: 20, enabled: false });

    const out = await runRadarScan('u1');

    expect(out).toBeNull();
    expect(prismaMock.radarRun.create).not.toHaveBeenCalled();
    expect(searchProviderMock.search).not.toHaveBeenCalled();
  });

  it('未配置 Tavily key → 早退 null, 不创建 RadarRun', async () => {
    configMock.getDecryptedTavilyKey.mockResolvedValue(null);

    const out = await runRadarScan('u1');

    expect(out).toBeNull();
    expect(prismaMock.radarRun.create).not.toHaveBeenCalled();
  });

  it('正常轮全链路: RadarRun 数据 + item 字段含 heatScore + candidate 词入库', async () => {
    searchProviderMock.search.mockResolvedValue([
      searchResult({ url: 'https://a.example.com/1', title: '标题一' }),
      searchResult({ url: 'https://b.example.com/2', title: '标题二', sourceSite: 'b.example.com' }),
    ]);
    llmCallMock.mockResolvedValue({
      result: readResult({ suggestedKeywords: ['新词A'] }),
      usage: {},
    });

    const out = await runRadarScan('u1');

    expect(out).not.toBeNull();
    expect(out!.runId).toBe('run1');
    expect(out!.searched).toBe(2);
    expect(out!.read).toBe(2);
    expect(out!.kept).toBe(2);
    expect(out!.errors).toEqual([]);

    expect(prismaMock.radarRun.create).toHaveBeenCalledWith({
      data: { userId: 'u1', keywordsUsed: ['AI 模型'] },
    });

    expect(prismaMock.radarItem.createMany).toHaveBeenCalledTimes(1);
    const itemsData = prismaMock.radarItem.createMany.mock.calls[0][0].data;
    expect(itemsData).toHaveLength(2);
    for (const item of itemsData) {
      expect(item.userId).toBe('u1');
      expect(item.runId).toBe('run1');
      expect(item.status).toBe('new');
      expect(typeof item.heatScore).toBe('number');
      expect(item.heatScore).toBeGreaterThanOrEqual(0);
      expect(item.heatScore).toBeLessThanOrEqual(100);
      expect(item.aiSummary).toBe('摘要');
      expect(item.aiAngle).toBe('切入角度');
      expect(item.heatFactors).toMatchObject({
        relevance: 80,
        freshness: 70,
        discussion: 60,
        feasibility: 75,
      });
    }

    expect(prismaMock.radarKeyword.createMany).toHaveBeenCalledTimes(1);
    const kwData = prismaMock.radarKeyword.createMany.mock.calls[0][0].data;
    expect(kwData).toEqual([{ userId: 'u1', text: '新词A', status: 'candidate', source: 'ai' }]);

    expect(prismaMock.radarRun.update).toHaveBeenCalledWith({
      where: { id: 'run1' },
      data: expect.objectContaining({ searched: 2, read: 2, kept: 2, errors: [] }),
    });
  });

  it('闸门丢弃: relevance < 40 → 不入库, kept < read', async () => {
    searchProviderMock.search.mockResolvedValue([searchResult()]);
    llmCallMock.mockResolvedValue({ result: readResult({ relevance: 20 }), usage: {} });

    const out = await runRadarScan('u1');

    expect(out!.read).toBe(1);
    expect(out!.kept).toBe(0);
    expect(prismaMock.radarItem.createMany).not.toHaveBeenCalled();
  });

  it('dailyLimit 截停: 读满上限即停, 不再继续调用 LLM', async () => {
    configMock.getRadarConfig.mockResolvedValue({ hasKey: true, dailyLimit: 1, enabled: true });
    searchProviderMock.search.mockResolvedValue([
      searchResult({ url: 'https://a.example.com/1', title: '标题一' }),
      searchResult({ url: 'https://b.example.com/2', title: '标题二', sourceSite: 'b.example.com' }),
    ]);

    const out = await runRadarScan('u1');

    expect(llmCallMock).toHaveBeenCalledTimes(1);
    expect(out!.read).toBe(1);
    expect(out!.kept).toBe(1);
  });

  it('单篇 LLM 失败 → 记 errors 并继续处理下一篇', async () => {
    searchProviderMock.search.mockResolvedValue([
      searchResult({ url: 'https://a.example.com/1', title: '标题一' }),
      searchResult({ url: 'https://b.example.com/2', title: '标题二', sourceSite: 'b.example.com' }),
    ]);
    llmCallMock
      .mockRejectedValueOnce(new Error('LLM 超时'))
      .mockResolvedValueOnce({ result: readResult(), usage: {} });

    const out = await runRadarScan('u1');

    expect(out!.read).toBe(2);
    expect(out!.kept).toBe(1);
    expect(out!.errors).toEqual([{ url: 'https://a.example.com/1', message: 'LLM 超时' }]);
    expect(prismaMock.radarItem.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.radarItem.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it('关键词搜索失败 → 记 errors 并继续下一个关键词', async () => {
    prismaMock.radarKeyword.findMany.mockResolvedValue([
      { id: 'k1', userId: 'u1', text: '词一', status: 'active', source: 'manual' },
      { id: 'k2', userId: 'u1', text: '词二', status: 'active', source: 'manual' },
    ]);
    searchProviderMock.search
      .mockRejectedValueOnce(new Error('Tavily 401'))
      .mockResolvedValueOnce([searchResult({ url: 'https://c.example.com/3', title: '标题三' })]);

    const out = await runRadarScan('u1');

    expect(searchProviderMock.search).toHaveBeenCalledTimes(2);
    expect(out!.searched).toBe(1);
    expect(out!.errors).toEqual([{ keyword: '词一', message: 'Tavily 401' }]);
    expect(out!.read).toBe(1);
    expect(out!.kept).toBe(1);
  });

  it('URL 已存在于库中 → 跳过, 不参与阅读', async () => {
    prismaMock.radarItem.findMany.mockResolvedValue([
      { url: 'https://a.example.com/1', titleHash: 'irrelevant-hash' },
    ]);
    searchProviderMock.search.mockResolvedValue([
      searchResult({ url: 'https://a.example.com/1', title: '标题一' }),
      searchResult({ url: 'https://b.example.com/2', title: '标题二', sourceSite: 'b.example.com' }),
    ]);

    const out = await runRadarScan('u1');

    expect(llmCallMock).toHaveBeenCalledTimes(1);
    expect(out!.read).toBe(1);
    expect(out!.kept).toBe(1);
    const itemsData = prismaMock.radarItem.createMany.mock.calls[0][0].data;
    expect(itemsData[0].url).toBe('https://b.example.com/2');
  });

  it('中途异常 (如事务失败) → RadarRun 兜底收尾记 fatal 错误, 并原样 rethrow', async () => {
    searchProviderMock.search.mockResolvedValue([searchResult()]);
    llmCallMock.mockResolvedValue({ result: readResult(), usage: {} });
    prismaMock.$transaction.mockRejectedValueOnce(new Error('事务写入失败'));

    await expect(runRadarScan('u1')).rejects.toThrow('事务写入失败');

    // 异常发生前已经跑完的进度 (searched/read) 不应因为兜底收尾而丢失。
    expect(prismaMock.radarRun.update).toHaveBeenCalledWith({
      where: { id: 'run1' },
      data: expect.objectContaining({
        searched: 1,
        read: 1,
        kept: 0,
        errors: [{ stage: 'fatal', message: '事务写入失败' }],
      }),
    });
  });

  it('累计预算: 前序 24h 已读 15, 上限 20 → 本轮只读 5 篇即停', async () => {
    configMock.getRadarConfig.mockResolvedValue({ hasKey: true, dailyLimit: 20, enabled: true });
    prismaMock.radarRun.aggregate.mockResolvedValue({ _sum: { read: 15 } });
    searchProviderMock.search.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) =>
        searchResult({ url: `https://a.example.com/${i}`, title: `标题${i}`, sourceSite: `s${i}.example.com` })
      )
    );

    const out = await runRadarScan('u1');

    expect(llmCallMock).toHaveBeenCalledTimes(5);
    expect(out!.read).toBe(5);
    expect(prismaMock.radarRun.aggregate).toHaveBeenCalledWith({
      _sum: { read: true },
      where: { userId: 'u1', startedAt: { gte: expect.any(Date) } },
    });
  });

  it('累计预算耗尽 (前序 24h 已读 ≥ 上限) → 不进入阅读循环, 记 budget 错误并返回该轮 (非 null)', async () => {
    configMock.getRadarConfig.mockResolvedValue({ hasKey: true, dailyLimit: 20, enabled: true });
    prismaMock.radarRun.aggregate.mockResolvedValue({ _sum: { read: 20 } });
    searchProviderMock.search.mockResolvedValue([searchResult()]);

    const out = await runRadarScan('u1');

    expect(out).not.toBeNull();
    expect(out!.read).toBe(0);
    expect(out!.kept).toBe(0);
    expect(out!.errors).toEqual([{ stage: 'budget', message: '今日阅读额度已用完' }]);
    expect(llmCallMock).not.toHaveBeenCalled();
    expect(prismaMock.radarItem.createMany).not.toHaveBeenCalled();
    expect(prismaMock.radarRun.update).toHaveBeenCalledWith({
      where: { id: 'run1' },
      data: expect.objectContaining({
        read: 0,
        kept: 0,
        errors: [{ stage: 'budget', message: '今日阅读额度已用完' }],
      }),
    });
  });

  it('标题指纹重复 (批内) → 跳过第二条, 不重复阅读', async () => {
    searchProviderMock.search.mockResolvedValue([
      searchResult({ url: 'https://a.example.com/1', title: '同一篇报道' }),
      // 全半角/空格差异, titleFingerprint 归一化后应视为同一指纹
      searchResult({ url: 'https://b.example.com/2', title: '同 一 篇 报道', sourceSite: 'b.example.com' }),
    ]);

    const out = await runRadarScan('u1');

    expect(llmCallMock).toHaveBeenCalledTimes(1);
    expect(out!.read).toBe(1);
    expect(out!.kept).toBe(1);
    const itemsData = prismaMock.radarItem.createMany.mock.calls[0][0].data;
    expect(itemsData[0].url).toBe('https://a.example.com/1');
  });
});
