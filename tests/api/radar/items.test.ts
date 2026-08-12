import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  radarItem: {
    findMany: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from '@/app/api/v1/radar/items/route';

function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'item1',
    userId: 'user1',
    url: 'https://example.com/a',
    titleHash: 'hash1',
    title: '标题A',
    sourceSite: 'example.com',
    publishedAt: null,
    collectedAt: new Date('2026-08-01T00:00:00.000Z'),
    matchedKeywords: ['AI'],
    aiSummary: '摘要',
    aiAngle: '角度',
    heatScore: 80,
    heatFactors: { relevance: 90, freshness: 80, discussion: 70, feasibility: 60 },
    status: 'new',
    inspirationId: null,
    runId: 'run1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.radarItem.findMany.mockResolvedValue([]);
});

describe('GET /api/v1/radar/items', () => {
  it('默认 status=new, 按 heatScore 降序 (orderBy 参数), scope userId', async () => {
    const res = await GET(new Request('http://t/api/v1/radar/items'));
    expect(res.status).toBe(200);
    expect(prismaMock.radarItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user1', status: 'new' },
        orderBy: { heatScore: 'desc' },
      }),
    );
  });

  it('传 status=adopted → where 里 status 跟随', async () => {
    await GET(new Request('http://t/api/v1/radar/items?status=adopted'));
    expect(prismaMock.radarItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user1', status: 'adopted' } }),
    );
  });

  it('非法 status → 400, 不查库', async () => {
    const res = await GET(new Request('http://t/api/v1/radar/items?status=bogus'));
    expect(res.status).toBe(400);
    expect(prismaMock.radarItem.findMany).not.toHaveBeenCalled();
  });

  it('displayScore = applyTimeDecay(heatScore, collectedAt, now) — 衰减后应小于原始 heatScore', async () => {
    // collectedAt 比 now 早很久 (固定日期), 衰减必然生效
    prismaMock.radarItem.findMany.mockResolvedValue([
      makeItem({ heatScore: 80, collectedAt: new Date('2000-01-01T00:00:00.000Z') }),
    ]);
    const res = await GET(new Request('http://t/api/v1/radar/items'));
    const json = await res.json();
    expect(json.data.items).toHaveLength(1);
    const it0 = json.data.items[0];
    expect(it0.heatScore).toBe(80);
    expect(it0.displayScore).toBeLessThan(80);
    expect(it0.displayScore).toBeGreaterThanOrEqual(0);
  });

  it('heatFactors 随条目一起返回', async () => {
    prismaMock.radarItem.findMany.mockResolvedValue([makeItem()]);
    const res = await GET(new Request('http://t/api/v1/radar/items'));
    const json = await res.json();
    expect(json.data.items[0].heatFactors).toEqual({
      relevance: 90, freshness: 80, discussion: 70, feasibility: 60,
    });
  });

  it('keyword 过滤: 只保留 matchedKeywords 命中的条目 (内存过滤)', async () => {
    prismaMock.radarItem.findMany.mockResolvedValue([
      makeItem({ id: 'a', matchedKeywords: ['AI绘画'] }),
      makeItem({ id: 'b', matchedKeywords: ['短视频运营'] }),
    ]);
    const res = await GET(new Request('http://t/api/v1/radar/items?keyword=AI绘画'));
    const json = await res.json();
    expect(json.data.items.map((i: { id: string }) => i.id)).toEqual(['a']);
  });

  it('keyword 未命中任何条目 → 空数组', async () => {
    prismaMock.radarItem.findMany.mockResolvedValue([makeItem({ matchedKeywords: ['AI绘画'] })]);
    const res = await GET(new Request('http://t/api/v1/radar/items?keyword=不存在的词'));
    const json = await res.json();
    expect(json.data.items).toEqual([]);
  });

  it('不传 keyword → 不过滤, 返回全部', async () => {
    prismaMock.radarItem.findMany.mockResolvedValue([
      makeItem({ id: 'a' }),
      makeItem({ id: 'b', matchedKeywords: ['别的词'] }),
    ]);
    const res = await GET(new Request('http://t/api/v1/radar/items'));
    const json = await res.json();
    expect(json.data.items).toHaveLength(2);
  });
});
