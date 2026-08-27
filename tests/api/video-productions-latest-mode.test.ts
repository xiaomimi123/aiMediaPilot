import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoProduction: { findFirst: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from '@/app/api/v1/cockpit/video-productions/latest/route';

const VP = {
  id: 'vp1',
  mode: 'talking-head-broll',
  status: 'queued',
  previewPath: null,
  masterPath: null,
  errorMessage: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoProduction.findFirst.mockResolvedValue(VP);
});

describe('GET video-productions/latest', () => {
  it('返回 mode —— 调用方要能判断这条记录跟当前交付方式对不对得上', async () => {
    const res = await GET(new Request('http://x/?contentId=c1'));
    const body = await res.json();
    expect(body.data.mode).toBe('talking-head-broll');
  });

  it('带 mode 参数时只查该模式的记录', async () => {
    await GET(new Request('http://x/?contentId=c1&mode=talking-head-broll'));
    expect(prismaMock.videoProduction.findFirst.mock.calls[0][0].where).toMatchObject({
      contentId: 'c1',
      mode: 'talking-head-broll',
    });
  });

  it('不带 mode 参数时不加这个过滤 —— 老调用方行为不变', async () => {
    await GET(new Request('http://x/?contentId=c1'));
    expect(prismaMock.videoProduction.findFirst.mock.calls[0][0].where.mode).toBeUndefined();
  });

  it('该模式下没有记录时返回 null, 不是回退到别的模式那条', async () => {
    prismaMock.videoProduction.findFirst.mockResolvedValue(null);
    const res = await GET(new Request('http://x/?contentId=c1&mode=talking-head-broll'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeNull();
  });

  it('乱传的 mode 不会被当成过滤条件打到数据库', async () => {
    await GET(new Request('http://x/?contentId=c1&mode=../../etc'));
    expect(prismaMock.videoProduction.findFirst.mock.calls[0][0].where.mode).toBeUndefined();
  });
});
