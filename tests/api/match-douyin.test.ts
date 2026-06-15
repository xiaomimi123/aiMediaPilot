import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  contentAnalysis: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/jobs/queue', () => ({
  QUEUES: { ANALYZE: 'analyze', RETRO: 'retro' },
  retroQueue: queueMock,
}));

import { POST } from '@/app/api/v1/content/analyses/[id]/match-douyin/route';

function makeReq(body: unknown): Request {
  return new Request('http://test/api/v1/content/analyses/abc/match-douyin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentAnalysis.findUnique.mockResolvedValue({
    id: 'abc',
    userId: 'user1',
    douyinAwemeId: null,
  });
  prismaMock.contentAnalysis.findFirst.mockResolvedValue(null);
  prismaMock.contentAnalysis.update.mockResolvedValue({});
  queueMock.add.mockResolvedValue({});
});

describe('POST match-douyin', () => {
  const ctx = { params: Promise.resolve({ id: 'abc' }) };

  it('valid match → 200, prisma.update 调用 + retroQueue.add 调用', async () => {
    const res = await POST(
      makeReq({ awemeId: '7234567890123456789', postedAt: '2026-06-10 14:30', plays: '8.5w', desc: 'test' }),
      ctx,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.retroEnqueued).toBe(true);
    expect(prismaMock.contentAnalysis.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'abc' },
        data: expect.objectContaining({
          douyinAwemeId: '7234567890123456789',
          douyinUrl: 'https://www.douyin.com/video/7234567890123456789',
          retroStatus: 'SCHEDULED',
        }),
      }),
    );
    expect(queueMock.add).toHaveBeenCalledWith(
      'retro',
      { analysisId: 'abc' },
      expect.objectContaining({ delay: 0 }),
    );
  });

  it('analysis 不存在 → 404', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ awemeId: '7234567890123456789', postedAt: '', plays: '0', desc: '' }), ctx);
    expect(res.status).toBe(404);
  });

  it('analysis 已有 douyinAwemeId → 409', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({
      id: 'abc',
      userId: 'user1',
      douyinAwemeId: '7000000000000000000',
    });
    const res = await POST(makeReq({ awemeId: '7234567890123456789', postedAt: '', plays: '0', desc: '' }), ctx);
    expect(res.status).toBe(409);
  });

  it('awemeId 非法 (< 8 位) → 400', async () => {
    const res = await POST(makeReq({ awemeId: '123', postedAt: '', plays: '0', desc: '' }), ctx);
    expect(res.status).toBe(400);
  });

  it('其他 analysis 已用此 awemeId → 409', async () => {
    prismaMock.contentAnalysis.findFirst.mockResolvedValueOnce({
      id: 'other-analysis',
    });
    const res = await POST(makeReq({ awemeId: '7234567890123456789', postedAt: '', plays: '0', desc: '' }), ctx);
    expect(res.status).toBe(409);
  });
});
