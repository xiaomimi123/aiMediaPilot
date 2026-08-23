import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn() },
  videoProduction: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from '@/app/api/v1/video-templates/[id]/productions/route';

beforeEach(() => vi.clearAllMocks());

function makeVp(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'vp1', userId: 'user1', templateId: 't1', status: 'done', mode: 'illustration-tts',
    masterPath: '/x/master.mp4', previewPath: '/x/preview.mp4', contentId: 'c1',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    srt: 'huge srt blob', alignedActs: [{ act: 'hook' }], rawTranscript: [{ text: 'x' }],
    ...overrides,
  };
}

describe('GET /api/v1/video-templates/[id]/productions', () => {
  it('模板不属于当前用户 → 404', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'other' });
    const res = await GET(new Request('http://x'), { params: { id: 't1' } });
    expect(res.status).toBe(404);
    expect(prismaMock.videoProduction.findMany).not.toHaveBeenCalled();
  });

  it('模板不存在 → 404', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue(null);
    const res = await GET(new Request('http://x'), { params: { id: 't1' } });
    expect(res.status).toBe(404);
  });

  it('只查该用户该模板的记录, 按 createdAt 倒序, 加上限', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });
    prismaMock.videoProduction.findMany.mockResolvedValue([makeVp()]);

    const res = await GET(new Request('http://x'), { params: { id: 't1' } });

    expect(res.status).toBe(200);
    const args = prismaMock.videoProduction.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ templateId: 't1', userId: 'user1' });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.take).toBeLessThanOrEqual(20);
  });

  it('查询时用 select 显式排除 srt/alignedActs/rawTranscript 这些大字段(mock prisma 不会自己按 select 过滤, 所以这里断言调用参数, 而不是断言 mock 返回值)', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });
    // 模拟真实 Prisma 按 select 返回——只给被选中的字段, 证明路由能正确透传这个精简形状。
    prismaMock.videoProduction.findMany.mockResolvedValue([{
      id: 'vp1', status: 'done', mode: 'illustration-tts',
      masterPath: '/x/master.mp4', previewPath: '/x/preview.mp4', contentId: 'c1',
      createdAt: '2026-08-01T00:00:00.000Z',
    }]);

    const res = await GET(new Request('http://x'), { params: { id: 't1' } });
    const json = await res.json();
    const item = json.data.productions[0];

    expect(item).toEqual({
      id: 'vp1', status: 'done', mode: 'illustration-tts',
      masterPath: '/x/master.mp4', previewPath: '/x/preview.mp4', contentId: 'c1',
      createdAt: '2026-08-01T00:00:00.000Z',
    });

    const args = prismaMock.videoProduction.findMany.mock.calls[0][0];
    expect(args.select).toEqual({
      id: true, status: true, mode: true, masterPath: true, previewPath: true,
      contentId: true, createdAt: true,
    });
    expect(args.select.srt).toBeUndefined();
    expect(args.select.alignedActs).toBeUndefined();
    expect(args.select.rawTranscript).toBeUndefined();
  });
});
