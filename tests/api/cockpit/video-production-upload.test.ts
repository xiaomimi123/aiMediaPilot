import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  videoProduction: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      writeFile: vi.fn(async () => undefined),
    },
  };
});

import { POST } from '@/app/api/v1/cockpit/video-productions/[id]/upload-source/route';

beforeEach(() => vi.clearAllMocks());

function makeMultipartReq(video: Blob | File, fileName = 'test.mp4'): Request {
  const fd = new FormData();
  fd.append('video', video, fileName);
  return new Request('http://x', { method: 'POST', body: fd });
}

describe('POST /api/v1/cockpit/video-productions/[id]/upload-source', () => {
  it('归属别的用户 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1',
      userId: 'other-user',
      mode: 'talking-head-broll',
      productionRoot: '/root/vp1',
    });
    const req = makeMultipartReq(new Blob([new Uint8Array(100)], { type: 'video/mp4' }));
    const res = await POST(req as any, { params: { id: 'vp1' } });
    expect(res.status).toBe(404);
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });

  it("mode !== 'talking-head-broll' → 400", async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1',
      userId: 'user1',
      mode: 'ppt-narration',
      productionRoot: '/root/vp1',
    });
    const req = makeMultipartReq(new Blob([new Uint8Array(100)], { type: 'video/mp4' }));
    const res = await POST(req as any, { params: { id: 'vp1' } });
    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });

  it('上传非视频 MIME → 400', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1',
      userId: 'user1',
      mode: 'talking-head-broll',
      productionRoot: '/root/vp1',
    });
    const req = makeMultipartReq(new Blob([new Uint8Array(100)], { type: 'image/png' }), 'a.png');
    const res = await POST(req as any, { params: { id: 'vp1' } });
    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });

  it('上传超过 500MB 上限 → 400', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1',
      userId: 'user1',
      mode: 'talking-head-broll',
      productionRoot: '/root/vp1',
    });
    const req = makeMultipartReq(new Blob([new Uint8Array(501 * 1024 * 1024)], { type: 'video/mp4' }));
    const res = await POST(req as any, { params: { id: 'vp1' } });
    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });

  it('正常上传 → 200, update 被调用且 status: source_uploaded', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1',
      userId: 'user1',
      mode: 'talking-head-broll',
      productionRoot: '/root/vp1',
    });
    prismaMock.videoProduction.update.mockResolvedValue({
      id: 'vp1',
      sourceVideoPath: '/root/vp1/source.mp4',
      status: 'source_uploaded',
    });
    const req = makeMultipartReq(new Blob([new Uint8Array(1024)], { type: 'video/mp4' }));
    const res = await POST(req as any, { params: { id: 'vp1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('source_uploaded');
    expect(prismaMock.videoProduction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vp1' },
        data: expect.objectContaining({ status: 'source_uploaded' }),
      }),
    );
  });
});
