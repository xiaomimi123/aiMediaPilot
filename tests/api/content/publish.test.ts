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
import { GET as detailGET } from '@/app/api/v1/content/analyses/[id]/route';

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
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({ id: 'a1', douyinAwemeId: '7234567890', retroStatus: null });
    const res = await retroNowPOST(new Request('http://x', { method: 'POST' }), { params: { id: 'a1' } });
    expect(res.status).toBe(200);
  });

  it('无 douyinAwemeId → 400', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({ id: 'a1', douyinAwemeId: null, retroStatus: null });
    const res = await retroNowPOST(new Request('http://x', { method: 'POST' }), { params: { id: 'a1' } });
    expect(res.status).toBe(400);
  });

  it('retroStatus=RUNNING → 400 (拒绝并发)', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({ id: 'a1', douyinAwemeId: '7234567890', retroStatus: 'RUNNING' });
    const res = await retroNowPOST(new Request('http://x', { method: 'POST' }), { params: { id: 'a1' } });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toMatch(/复盘正在进行中/);
  });
});

describe('GET projection — BigInt + Date serialization', () => {
  it('Date 字段序列化为 ISO 字符串, 不被破坏为 {}', async () => {
    const now = new Date();
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({
      id: 'a1',
      videoFilename: 'x.mp4',
      videoDurationSec: 60,
      videoMimeType: 'video/mp4',
      status: 'COMPLETED',
      errorMessage: null,
      progress: null,
      retryCount: 0,
      report: null,
      llmUsage: null,
      coverCandidates: null,
      createdAt: now,
      startedAt: now,
      completedAt: now,
      douyinUrl: null,
      douyinAwemeId: null,
      publishedAt: null,
      retroStatus: null,
      retroErrorMessage: null,
      retroReport: null,
      retroStartedAt: null,
      retroCompletedAt: null,
      actualMetrics: [],
    });
    const res = await detailGET(new Request('http://x'), { params: { id: 'a1' } });
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(typeof json.data.createdAt).toBe('string');
    expect(json.data.createdAt).toBe(now.toISOString());
  });

  it('BigInt 字段在 actualMetric 里序列化为字符串', async () => {
    const now = new Date();
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({
      id: 'a1',
      videoFilename: 'x.mp4',
      videoDurationSec: 60,
      videoMimeType: 'video/mp4',
      status: 'COMPLETED',
      errorMessage: null,
      progress: null,
      retryCount: 0,
      report: null,
      llmUsage: null,
      coverCandidates: null,
      createdAt: now,
      startedAt: now,
      completedAt: now,
      douyinUrl: null,
      douyinAwemeId: null,
      publishedAt: null,
      retroStatus: 'COMPLETED',
      retroErrorMessage: null,
      retroReport: null,
      retroStartedAt: now,
      retroCompletedAt: now,
      actualMetrics: [{
        id: 'm1', snapshotAt: now, daysAfterPublish: 3.0, source: 'douyin-creator-center',
        plays: 12345n, likes: 1234n, comments: 234n, shares: 45n, collects: 123n,
        likeRateBp: 999, commentRateBp: 189, shareRateBp: 36,
        completionRateBp: 3210, retention3sBp: 6540, followConversionBp: 120,
        topComments: null, createdAt: now,
      }],
    });
    const res = await detailGET(new Request('http://x'), { params: { id: 'a1' } });
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.actualMetric.plays).toBe('12345');
    expect(typeof json.data.actualMetric.snapshotAt).toBe('string');
  });
});
