import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoProduction: { findUnique: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const fsMock = vi.hoisted(() => ({ rm: vi.fn(async (_p: string, _o?: unknown) => undefined) }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

import { DELETE } from '@/app/api/v1/cockpit/video-productions/[id]/route';

beforeEach(() => vi.clearAllMocks());

function vp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vp1', userId: 'user1', status: 'preview_ready',
    productionRoot: './video-productions/vp1',
    ...overrides,
  };
}

const req = () => new Request('http://x', { method: 'DELETE' });

describe('DELETE /api/v1/cockpit/video-productions/[id]', () => {
  it('删除已完成的任务: 记录与产物目录一并清掉', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(vp({ status: 'done' }));
    prismaMock.videoProduction.delete.mockResolvedValue({ id: 'vp1' });

    const res = await DELETE(req(), { params: { id: 'vp1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.videoProduction.delete).toHaveBeenCalledTimes(1);
    expect(fsMock.rm).toHaveBeenCalledTimes(1);
    expect(fsMock.rm.mock.calls[0][0]).toContain('vp1');
  });

  it('删除失败的任务(用户清理垃圾的主要场景)', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(vp({ status: 'failed' }));
    prismaMock.videoProduction.delete.mockResolvedValue({ id: 'vp1' });
    const res = await DELETE(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(200);
  });

  it('删除预览就绪的任务(不满意的那版)', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(vp({ status: 'preview_ready' }));
    prismaMock.videoProduction.delete.mockResolvedValue({ id: 'vp1' });
    const res = await DELETE(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(200);
  });

  it('归属别的用户 → 404, 既不删库也不动文件', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(vp({ userId: 'other' }));
    const res = await DELETE(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(404);
    expect(prismaMock.videoProduction.delete).not.toHaveBeenCalled();
    expect(fsMock.rm).not.toHaveBeenCalled();
  });

  it('任务不存在 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(null);
    const res = await DELETE(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(404);
  });

  it.each(['queued', 'directing', 'building', 'assembling', 'approved', 'rendering', 'packaging'])(
    '进行中(%s)拒绝删除 —— worker 还在往这个目录写, 删了会让它中途崩在莫名其妙的地方',
    async (status) => {
      prismaMock.videoProduction.findUnique.mockResolvedValue(vp({ status }));
      const res = await DELETE(req(), { params: { id: 'vp1' } });
      expect(res.status).toBe(400);
      expect(prismaMock.videoProduction.delete).not.toHaveBeenCalled();
      expect(fsMock.rm).not.toHaveBeenCalled();
    },
  );

  it('产物目录清理失败不阻断删除 —— 记录已经没了, 留个孤儿目录不影响正确性', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(vp({ status: 'done' }));
    prismaMock.videoProduction.delete.mockResolvedValue({ id: 'vp1' });
    fsMock.rm.mockRejectedValueOnce(new Error('EACCES'));

    const res = await DELETE(req(), { params: { id: 'vp1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.videoProduction.delete).toHaveBeenCalledTimes(1);
  });
});
