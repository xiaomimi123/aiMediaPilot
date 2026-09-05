import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const prismaMock = { videoProduction: { findUnique: vi.fn() } };
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: async () => ({ id: 'user1' }) }));

const { GET } = await import('@/app/api/v1/cockpit/video-productions/[id]/audio/route');

beforeEach(() => vi.clearAllMocks());

describe('GET .../audio', () => {
  it('任务不存在 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(null);
    const res = await GET(new Request('http://t/a'), { params: { id: 'x' } });
    expect(res.status).toBe(404);
  });

  it('别人的任务 → 404(不泄漏存在性)', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ id: 'vp1', userId: 'other', productionRoot: '/tmp' });
    const res = await GET(new Request('http://t/a'), { params: { id: 'vp1' } });
    expect(res.status).toBe(404);
  });

  it('音频文件不存在(无声任务) → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1', userId: 'user1', productionRoot: '/tmp/definitely-not-here-32',
    });
    const res = await GET(new Request('http://t/a'), { params: { id: 'vp1' } });
    expect(res.status).toBe(404);
  });
});

describe('GET .../audio — Range 支持(Player 拖时间轴需要 seek)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-audio-'));
  const filePath = path.join(root, 'tts-audio.wav');
  const content = Buffer.alloc(2000, 1);
  fs.writeFileSync(filePath, content);

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('无 Range 头 → 200 全量, Content-Length 等于文件大小', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ id: 'vp1', userId: 'user1', productionRoot: root });
    const res = await GET(new Request('http://t/a'), { params: { id: 'vp1' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(content.length));
    expect(res.headers.get('content-type')).toBe('audio/wav');
  });

  it('带 Range: bytes=0-1023 → 206 + Content-Range + Accept-Ranges', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ id: 'vp1', userId: 'user1', productionRoot: root });
    const res = await GET(new Request('http://t/a', { headers: { Range: 'bytes=0-1023' } }), { params: { id: 'vp1' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-1023/${content.length}`);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe('1024');
  });

  it('Range 越界 → 416', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ id: 'vp1', userId: 'user1', productionRoot: root });
    const res = await GET(new Request('http://t/a', { headers: { Range: `bytes=${content.length + 100}-` } }), { params: { id: 'vp1' } });
    expect(res.status).toBe(416);
  });
});
