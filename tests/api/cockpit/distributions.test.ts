import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  distribution: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from '@/app/api/v1/cockpit/distributions/route';

function req(url: string): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.distribution.findMany.mockResolvedValue([]);
});

describe('GET /api/v1/cockpit/distributions', () => {
  it('正常: 有记录 → 200 + items, 按 userId + 映射后的 platform 过滤', async () => {
    prismaMock.distribution.findMany.mockResolvedValueOnce([
      {
        id: 'dist1',
        platform: 'bilibili',
        url: 'https://www.bilibili.com/video/BV1',
        publishedAt: new Date('2026-08-01T00:00:00.000Z'),
        scriptDraft: { topic: '3 个 AI 工具' },
      },
    ]);
    const res = await GET(req('http://t/api/v1/cockpit/distributions?platform=bilibili'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items).toEqual([
      {
        id: 'dist1',
        platform: 'bilibili',
        url: 'https://www.bilibili.com/video/BV1',
        publishedAt: '2026-08-01T00:00:00.000Z',
        sourceTopic: '3 个 AI 工具',
      },
    ]);
    expect(prismaMock.distribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { platform: 'bilibili', scriptDraft: { userId: 'user1' } },
      }),
    );
  });

  it('cockpit "x" key 映射到 Distribution 的 "twitter" 值', async () => {
    await GET(req('http://t/api/v1/cockpit/distributions?platform=x'));
    expect(prismaMock.distribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { platform: 'twitter', scriptDraft: { userId: 'user1' } },
      }),
    );
  });

  it('空: 无记录 → 200 + 空数组', async () => {
    const res = await GET(req('http://t/api/v1/cockpit/distributions?platform=douyin'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items).toEqual([]);
  });

  it('缺少 platform → 400, 不查库', async () => {
    const res = await GET(req('http://t/api/v1/cockpit/distributions'));
    expect(res.status).toBe(400);
    expect(prismaMock.distribution.findMany).not.toHaveBeenCalled();
  });

  it('非法 platform → 400, 不查库', async () => {
    const res = await GET(req('http://t/api/v1/cockpit/distributions?platform=not-a-platform'));
    expect(res.status).toBe(400);
    expect(prismaMock.distribution.findMany).not.toHaveBeenCalled();
  });
});
