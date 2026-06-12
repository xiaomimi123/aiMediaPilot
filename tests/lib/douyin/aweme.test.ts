import { describe, expect, it, vi, beforeEach } from 'vitest';
import { extractAwemeIdFromLongUrl, resolveDouyinUrl } from '@/lib/douyin/aweme';

describe('extractAwemeIdFromLongUrl', () => {
  it('从标准长链提取 aweme_id', () => {
    expect(extractAwemeIdFromLongUrl('https://www.douyin.com/video/7234567890123456789')).toBe('7234567890123456789');
  });

  it('忽略 query 和 hash', () => {
    expect(extractAwemeIdFromLongUrl('https://www.douyin.com/video/7234567890123456789?modal=1#x')).toBe('7234567890123456789');
  });

  it('带斜杠尾巴也能提取', () => {
    expect(extractAwemeIdFromLongUrl('https://www.douyin.com/video/7234567890123456789/')).toBe('7234567890123456789');
  });

  it('非 douyin URL 返回 null', () => {
    expect(extractAwemeIdFromLongUrl('https://example.com/video/123')).toBeNull();
  });

  it('短链返回 null (应走 resolveDouyinUrl)', () => {
    expect(extractAwemeIdFromLongUrl('https://v.douyin.com/abc123')).toBeNull();
  });
});

describe('resolveDouyinUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('长链直接返回 aweme_id', async () => {
    const result = await resolveDouyinUrl('https://www.douyin.com/video/7234567890123456789');
    expect(result).toBe('7234567890123456789');
  });

  it('短链 HEAD 后从 Location 提取', async () => {
    const fetchMock = vi.fn(async () => ({
      headers: new Headers({ location: 'https://www.douyin.com/video/7234567890123456789/?u=1' }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveDouyinUrl('https://v.douyin.com/abc123', { fetch: fetchMock as any });
    expect(result).toBe('7234567890123456789');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://v.douyin.com/abc123',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' })
    );
  });

  it('短链 HEAD 超时返回 null', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('aborted');
    });
    const result = await resolveDouyinUrl('https://v.douyin.com/abc123', { fetch: fetchMock as any });
    expect(result).toBeNull();
  });

  it('短链 HEAD 拿到的 location 不是 douyin 视频链返回 null', async () => {
    const fetchMock = vi.fn(async () => ({
      headers: new Headers({ location: 'https://example.com/' }),
    } as Response));
    const result = await resolveDouyinUrl('https://v.douyin.com/abc123', { fetch: fetchMock as any });
    expect(result).toBeNull();
  });
});
