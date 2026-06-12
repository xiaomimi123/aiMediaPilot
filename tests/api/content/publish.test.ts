import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  contentAnalysis: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async (args: any) => ({ id: 'a1', ...args.data })),
  },
  actualMetric: { deleteMany: vi.fn(async () => ({ count: 0 })) },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.mock('@/lib/douyin/aweme', () => ({
  resolveDouyinUrl: vi.fn(async (url: string) => {
    if (url.includes('douyin.com/video/')) return url.match(/\/video\/(\d+)/)![1];
    return null;
  }),
}));

vi.mock('@/jobs/queue', () => ({ retroQueue: { add: vi.fn() } }));

import { POST as publishPOST } from '@/app/api/v1/content/analyses/[id]/publish/route';
import { POST as retroNowPOST } from '@/app/api/v1/content/analyses/[id]/retro-now/route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentAnalysis.findUnique.mockResolvedValue({ id: 'a1', retroStatus: null });
  prismaMock.contentAnalysis.findFirst.mockResolvedValue(null);
});

function makeReq(body: any): Request {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

describe('POST /publish', () => {
  it('长链 happy path', async () => {
    const res = await publishPOST(
      makeReq({ url: 'https://www.douyin.com/video/7234567890', publishedAt: new Date(Date.now() - 86400000).toISOString() }),
      { params: { id: 'a1' } }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.scheduledAt).toBeDefined();
    expect(prismaMock.actualMetric.deleteMany).toHaveBeenCalled();
  });

  it('publishedAt 在未来 → 400', async () => {
    const res = await publishPOST(
      makeReq({ url: 'https://www.douyin.com/video/7234567890', publishedAt: new Date(Date.now() + 86400000).toISOString() }),
      { params: { id: 'a1' } }
    );
    expect(res.status).toBe(400);
  });

  it('URL 不解析 → 400', async () => {
    const res = await publishPOST(
      makeReq({ url: 'https://example.com/x', publishedAt: new Date(Date.now() - 86400000).toISOString() }),
      { params: { id: 'a1' } }
    );
    expect(res.status).toBe(400);
  });

  it('同 awemeId 已关联其他 analysis → 400', async () => {
    prismaMock.contentAnalysis.findFirst.mockResolvedValueOnce({ id: 'other', douyinAwemeId: '7234567890' });
    const res = await publishPOST(
      makeReq({ url: 'https://www.douyin.com/video/7234567890', publishedAt: new Date(Date.now() - 86400000).toISOString() }),
      { params: { id: 'a1' } }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toMatch(/已关联/);
  });

  it('retroStatus=RUNNING → 400 (拒绝并发)', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({ id: 'a1', retroStatus: 'RUNNING' });
    const res = await publishPOST(
      makeReq({ url: 'https://www.douyin.com/video/7234567890', publishedAt: new Date(Date.now() - 86400000).toISOString() }),
      { params: { id: 'a1' } }
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /retro-now', () => {
  it('happy path', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({ id: 'a1', douyinAwemeId: '7234567890' });
    const res = await retroNowPOST(new Request('http://x', { method: 'POST' }), { params: { id: 'a1' } });
    expect(res.status).toBe(200);
  });

  it('无 douyinAwemeId → 400', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({ id: 'a1', douyinAwemeId: null });
    const res = await retroNowPOST(new Request('http://x', { method: 'POST' }), { params: { id: 'a1' } });
    expect(res.status).toBe(400);
  });
});
