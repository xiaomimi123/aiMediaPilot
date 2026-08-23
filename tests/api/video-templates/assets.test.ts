import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

// 显式给会被 .mock.calls[0][0] 取用的 mock 标注参数类型 —— 否则 vi.fn(async () => undefined)
// 推出的调用记录是空元组 `[]`, 在本项目的 strict tsconfig 下过不了 tsc (同 packaging.test.ts 的教训)。
const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(async (_path: string, _opts?: unknown) => undefined),
  writeFile: vi.fn(async (_path: string, _data: unknown) => undefined),
}));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

import { POST } from '@/app/api/v1/video-templates/[id]/assets/route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });
  prismaMock.videoTemplate.update.mockResolvedValue({ id: 't1' });
});

function uploadReq(kind: string, file: Blob, fileName: string): Request {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', file, fileName);
  return new Request('http://x', { method: 'POST', body: fd });
}

const mp3 = () => new Blob([new Uint8Array(1000)], { type: 'audio/mpeg' });
const mp4 = () => new Blob([new Uint8Array(1000)], { type: 'video/mp4' });

describe('POST /api/v1/video-templates/[id]/assets', () => {
  it('上传 BGM → 落盘并回写 bgmPath', async () => {
    const res = await POST(uploadReq('bgm', mp3(), 'song.mp3') as any, { params: { id: 't1' } });
    expect(res.status).toBe(200);
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
    expect(prismaMock.videoTemplate.update.mock.calls[0][0].data.bgmPath).toContain('t1');
  });

  it('上传片头 → 回写 introPath', async () => {
    await POST(uploadReq('intro', mp4(), 'intro.mp4') as any, { params: { id: 't1' } });
    expect(prismaMock.videoTemplate.update.mock.calls[0][0].data.introPath).toContain('t1');
  });

  it('上传片尾 → 回写 outroPath', async () => {
    await POST(uploadReq('outro', mp4(), 'outro.mp4') as any, { params: { id: 't1' } });
    expect(prismaMock.videoTemplate.update.mock.calls[0][0].data.outroPath).toContain('t1');
  });

  it('非法 kind → 400, 不落盘', async () => {
    const res = await POST(uploadReq('whatever', mp4(), 'x.mp4') as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('BGM 位置传了视频文件 → 400(MIME 白名单按 kind 区分)', async () => {
    const res = await POST(uploadReq('bgm', mp4(), 'x.mp4') as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('超过大小上限 → 400', async () => {
    // 注意: brief 原文用 Object.defineProperty 伪造 size, 但 Node 原生 Request/FormData
    // 在 .formData() 重新解析 multipart body 时会按实际字节数重算 size, 伪造值不会存活
    // 这次往返(已用独立脚本验证)。这里改用真实超限字节数, 语义不变, 只是不再取巧。
    const huge = new Blob([new Uint8Array(50 * 1024 * 1024 + 1)], { type: 'audio/mpeg' });
    const res = await POST(uploadReq('bgm', huge, 'big.mp3') as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('归属别的用户 → 404', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'other' });
    const res = await POST(uploadReq('bgm', mp3(), 'x.mp3') as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('恶意文件名不会拼出越权路径(扩展名白名单)', async () => {
    await POST(uploadReq('bgm', mp3(), '../../etc/passwd.mp3') as any, { params: { id: 't1' } });
    const writtenPath = fsMock.writeFile.mock.calls[0][0] as string;
    expect(writtenPath).not.toContain('..');
    expect(writtenPath).toContain('t1');
  });
});
