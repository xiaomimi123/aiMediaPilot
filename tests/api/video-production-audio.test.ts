import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const prismaMock = { videoProduction: { findUnique: vi.fn() } };
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: async () => ({ id: 'user1' }) }));

const { GET } = await import('@/app/api/v1/cockpit/video-productions/[id]/audio/route');

beforeEach(() => vi.clearAllMocks());

// 复用一份真实存在的音频文件 —— 「别人的任务」这条鉴权测试必须让文件真的
// 在盘上, 否则 404 到底是鉴权拦的还是文件不存在给的分不清 (曾经的假阳性)。
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-audio-'));
const filePath = path.join(root, 'tts-audio.wav');
const content = Buffer.alloc(2000, 1);
fs.writeFileSync(filePath, content);
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('GET .../audio', () => {
  it('任务不存在 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(null);
    const res = await GET(new Request('http://t/a'), { params: { id: 'x' } });
    expect(res.status).toBe(404);
  });

  it('别人的任务 → 404(不泄漏存在性)，即使文件真实存在', async () => {
    // 关键: productionRoot 指向真实存在 tts-audio.wav 的目录, 排除
    // 「404 其实是文件不存在给的」这种假阳性——鉴权判断必须在 stat 之前拦下。
    prismaMock.videoProduction.findUnique.mockResolvedValue({ id: 'vp1', userId: 'other', productionRoot: root });
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

  it('后缀式 Range: bytes=-500 → 206, 取文件末尾 500 字节', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ id: 'vp1', userId: 'user1', productionRoot: root });
    const res = await GET(new Request('http://t/a', { headers: { Range: 'bytes=-500' } }), { params: { id: 'vp1' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes ${content.length - 500}-${content.length - 1}/${content.length}`);
    expect(res.headers.get('content-length')).toBe('500');
  });

  it('畸形 Range: bytes=abc → 无法解析, 降级为 200 全量', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ id: 'vp1', userId: 'user1', productionRoot: root });
    const res = await GET(new Request('http://t/a', { headers: { Range: 'bytes=abc' } }), { params: { id: 'vp1' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(content.length));
  });

  it('多段 Range: bytes=0-100,200-300 → 退化为 200 全量(不静默只服务第一段)', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ id: 'vp1', userId: 'user1', productionRoot: root });
    const res = await GET(new Request('http://t/a', { headers: { Range: 'bytes=0-100,200-300' } }), { params: { id: 'vp1' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(content.length));
  });
});
