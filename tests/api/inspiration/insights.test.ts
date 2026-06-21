import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  inspirationInsight: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET as listGET } from '@/app/api/v1/inspiration/insights/route';
import { GET as byIdGET } from '@/app/api/v1/inspiration/insights/[id]/route';

const SAMPLE_OUTPUT = {
  titlePatterns: ['数字开头'],
  hookTypes: ['数字', '反差'],
  durationInsight: '45-60s 最优',
  topicClusters: ['AI 工具'],
  recommendedTopics: [{ title: '主题一示例', rationale: '理由一示例长一点' }],
  summary: '总结测试'.repeat(10),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/inspiration/insights (list)', () => {
  it('返回用户所有 insights, 按时间倒序', async () => {
    prismaMock.inspirationInsight.findMany.mockResolvedValue([
      {
        id: 'i1',
        videoIds: ['v1', 'v2'],
        output: SAMPLE_OUTPUT,
        generatedAt: new Date('2026-06-20T10:00:00Z'),
      },
      {
        id: 'i2',
        videoIds: ['v3'],
        output: SAMPLE_OUTPUT,
        generatedAt: new Date('2026-06-19T10:00:00Z'),
      },
    ]);
    const res = await listGET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items).toHaveLength(2);
    expect(json.data.items[0].id).toBe('i1');
    expect(json.data.items[0].generatedAt).toBe('2026-06-20T10:00:00.000Z');
    expect(prismaMock.inspirationInsight.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user1' },
        orderBy: { generatedAt: 'desc' },
        take: 30,
      }),
    );
  });

  it('无 insight → 空数组', async () => {
    prismaMock.inspirationInsight.findMany.mockResolvedValue([]);
    const res = await listGET();
    const json = await res.json();
    expect(json.data.items).toEqual([]);
  });
});

describe('GET /api/v1/inspiration/insights/[id]', () => {
  it('属于当前用户 → 200 + output', async () => {
    prismaMock.inspirationInsight.findFirst.mockResolvedValue({
      id: 'i1',
      videoIds: ['v1', 'v2'],
      output: SAMPLE_OUTPUT,
      generatedAt: new Date('2026-06-20T10:00:00Z'),
    });
    const res = await byIdGET(new Request('http://t'), { params: { id: 'i1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe('i1');
    expect(json.data.output.hookTypes).toEqual(['数字', '反差']);
  });

  it('查询用 (id, userId) 双 where 检查 ownership', async () => {
    prismaMock.inspirationInsight.findFirst.mockResolvedValue(null);
    await byIdGET(new Request('http://t'), { params: { id: 'other' } });
    expect(prismaMock.inspirationInsight.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'other', userId: 'user1' },
      }),
    );
  });

  it('不存在或不属于当前用户 → 404', async () => {
    prismaMock.inspirationInsight.findFirst.mockResolvedValue(null);
    const res = await byIdGET(new Request('http://t'), { params: { id: 'nope' } });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});
