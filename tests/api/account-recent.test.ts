import { describe, expect, it, vi, beforeEach } from 'vitest';

const adapterMock = vi.hoisted(() => ({ fetchAccountRecentVideos: vi.fn() }));
vi.mock('@/lib/account/recent-videos-adapter', () => adapterMock);

import { GET } from '@/app/api/v1/account/recent/route';
import { __resetRecentCache } from '@/lib/account/recent-cache';

function req(qs = ''): Request {
  return new Request(`http://t/api/v1/account/recent${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRecentCache();
});

describe('GET /api/v1/account/recent', () => {
  it('正常抓取 → 200 + videos + cached=false', async () => {
    adapterMock.fetchAccountRecentVideos.mockResolvedValueOnce([
      { awemeId: '1', title: 'x' },
    ] as any);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.videos).toHaveLength(1);
    expect(json.data.cached).toBe(false);
  });

  it('adapter 返回 null (登录过期) → 502, 不写 cache', async () => {
    adapterMock.fetchAccountRecentVideos.mockResolvedValueOnce(null);
    const res = await GET(req());
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/登录态过期/);
  });

  it('登录过期后 60s 内后续请求不走 cache — 之前会静默 200 + 空数组', async () => {
    // 1st: null → 502
    adapterMock.fetchAccountRecentVideos.mockResolvedValueOnce(null);
    const r1 = await GET(req());
    expect(r1.status).toBe(502);

    // 2nd: adapter 又被真的调, 而不是 cache hit
    adapterMock.fetchAccountRecentVideos.mockResolvedValueOnce([{ awemeId: '1' }] as any);
    const r2 = await GET(req());
    expect(r2.status).toBe(200);
    expect(adapterMock.fetchAccountRecentVideos).toHaveBeenCalledTimes(2);
    const json = await r2.json();
    expect(json.data.cached).toBe(false);
    expect(json.data.videos).toHaveLength(1);
  });

  it('成功抓取后 60s 内命中 cache', async () => {
    adapterMock.fetchAccountRecentVideos.mockResolvedValueOnce([{ awemeId: '1' }] as any);
    await GET(req());
    // 2nd call 应该命中 cache, adapter 不被调用
    const r2 = await GET(req());
    expect(adapterMock.fetchAccountRecentVideos).toHaveBeenCalledTimes(1);
    const json = await r2.json();
    expect(json.data.cached).toBe(true);
  });

  it('force=1 绕过 cache', async () => {
    adapterMock.fetchAccountRecentVideos
      .mockResolvedValueOnce([{ awemeId: '1' }] as any)
      .mockResolvedValueOnce([{ awemeId: '2' }] as any);
    await GET(req());
    const r2 = await GET(req('?force=1'));
    expect(adapterMock.fetchAccountRecentVideos).toHaveBeenCalledTimes(2);
    const json = await r2.json();
    expect(json.data.videos[0].awemeId).toBe('2');
  });
});
