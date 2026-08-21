import { describe, expect, it, vi, beforeEach } from 'vitest';

// 归属校验补漏 (十八期): analyses/[id] 路由族里 route.ts(GET/DELETE)/cancel/retry/
// publish/events/cover/[idx] 六处此前完全没有 userId 校验 (与同族的 checklist/
// match-douyin 两处不一致), 本文件只测这一件事——跨用户访问一律 404, 不测原有业务逻辑
// (那些沿用各路由自己的既有行为, 未改动)。

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  contentAnalysis: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  actualMetric: {
    deleteMany: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.mock('@/jobs/queue', () => ({
  analyzeQueue: { add: vi.fn() },
  retroQueue: { add: vi.fn() },
}));

vi.mock('@/lib/douyin/aweme', () => ({
  resolveDouyinUrl: vi.fn(async () => 'aweme1'),
}));

vi.mock('fs', () => ({
  promises: {
    rm: vi.fn(async () => undefined),
    readFile: vi.fn(async () => Buffer.from('')),
  },
}));

import { GET, DELETE } from '@/app/api/v1/content/analyses/[id]/route';
import { POST as CANCEL } from '@/app/api/v1/content/analyses/[id]/cancel/route';
import { POST as RETRY } from '@/app/api/v1/content/analyses/[id]/retry/route';
import { POST as PUBLISH } from '@/app/api/v1/content/analyses/[id]/publish/route';
import { GET as EVENTS } from '@/app/api/v1/content/analyses/[id]/events/route';
import { GET as COVER } from '@/app/api/v1/content/analyses/[id]/cover/[idx]/route';

const OTHER_USER = { id: 'abc', userId: 'other-user' };
const ctx = { params: { id: 'abc' } };

function getReq(): Request {
  return new Request('http://t/api/v1/content/analyses/abc');
}
function postReq(body?: unknown): Request {
  return new Request('http://t/api/v1/content/analyses/abc', {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('analyses/[id] 路由族 — 跨用户归属校验', () => {
  it('GET route.ts: 属于别的用户 → 404', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValue({ ...OTHER_USER, coverCandidates: [], actualMetrics: [], fromScripts: [] });
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(404);
  });

  it('GET route.ts: 记录不存在 → 404', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValue(null);
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(404);
  });

  it('DELETE route.ts: 属于别的用户 → 404, 不删数据不删文件', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValue({ ...OTHER_USER, status: 'COMPLETED', retroStatus: 'IDLE' });
    const res = await DELETE(getReq(), ctx);
    expect(res.status).toBe(404);
    expect(prismaMock.contentAnalysis.delete).not.toHaveBeenCalled();
  });

  it('cancel: 属于别的用户 → 404, 不更新状态', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValue({ ...OTHER_USER, status: 'ANALYZING' });
    const res = await CANCEL(postReq(), ctx);
    expect(res.status).toBe(404);
    expect(prismaMock.contentAnalysis.update).not.toHaveBeenCalled();
  });

  it('retry: 属于别的用户 → 404, 不入队', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValue({ ...OTHER_USER, status: 'FAILED', retryCount: 0 });
    const res = await RETRY(postReq(), ctx);
    expect(res.status).toBe(404);
    expect(prismaMock.contentAnalysis.update).not.toHaveBeenCalled();
  });

  it('publish: 属于别的用户 → 404, 不写 douyinUrl', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValue({ ...OTHER_USER, retroStatus: 'IDLE' });
    const res = await PUBLISH(postReq({ url: 'https://v.douyin.com/x', publishedAt: '2026-01-01T00:00:00.000Z' }), ctx);
    expect(res.status).toBe(404);
    expect(prismaMock.contentAnalysis.update).not.toHaveBeenCalled();
  });

  it('events (SSE): 属于别的用户 → 404, 不开流', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValue({ userId: 'other-user' });
    const res = await EVENTS(getReq(), ctx);
    expect(res.status).toBe(404);
  });

  it('cover/[idx]: 属于别的用户 → 404, 不读文件', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValue({ ...OTHER_USER, coverCandidates: [{ path: '/uploads/abc/cover-0.jpg' }] });
    const res = await COVER(getReq(), { params: { id: 'abc', idx: '0' } });
    expect(res.status).toBe(404);
  });
});
