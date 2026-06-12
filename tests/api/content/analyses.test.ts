import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    contentAnalysis: {
      create: vi.fn(async (args: any) => ({ id: 'a1', ...args.data, createdAt: new Date() })),
      findMany: vi.fn(async () => [{ id: 'a1', status: 'COMPLETED', createdAt: new Date(), videoFilename: 'x.mp4', report: { overallScore: 80 } }]),
    },
  },
}));
vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/jobs/queue', () => ({ analyzeQueue: { add: vi.fn() } }));
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, mkdir: vi.fn(async () => undefined), writeFile: vi.fn(async () => undefined) };
});

import { POST, GET } from '@/app/api/v1/content/analyses/route';

beforeEach(() => vi.clearAllMocks());

function makeMultipart(videoSize: number, videoType = 'video/mp4', fields: Record<string, string> = {}): Request {
  const fd = new FormData();
  const buf = new Uint8Array(videoSize);
  fd.append('video', new Blob([buf], { type: videoType }), 'test.mp4');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request('http://x', { method: 'POST', body: fd });
}

describe('POST /api/v1/content/analyses', () => {
  it('拒收非 video MIME', async () => {
    const fd = new FormData();
    fd.append('video', new Blob([new Uint8Array(100)], { type: 'image/png' }), 'a.png');
    const req = new Request('http://x', { method: 'POST', body: fd });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('拒收 > 500MB', async () => {
    const res = await POST(makeMultipart(501 * 1024 * 1024));
    expect(res.status).toBe(400);
  });

  it('happy path 入库 + 入队', async () => {
    const res = await POST(makeMultipart(1024));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.analysisId).toBe('a1');
  });
});

describe('GET /api/v1/content/analyses', () => {
  it('返回列表', async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data[0].id).toBe('a1');
  });
});
