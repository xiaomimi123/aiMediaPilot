import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveDouyinShortLink, resolveXhsShortLink } from '@/lib/inspiration/short-link-resolver';

const origFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  global.fetch = origFetch;
});

function mockFetchResponse(finalUrl: string, body = '') {
  global.fetch = vi.fn(async () => ({
    url: finalUrl,
    text: async () => body,
  })) as any;
}

describe('resolveXhsShortLink', () => {
  it('redirect 到 explore/<hex> → 抽 noteId', async () => {
    mockFetchResponse('https://www.xiaohongshu.com/explore/6528abcd1234567890abcdef?param=1');
    const r = await resolveXhsShortLink('https://xhslink.com/a/AbCd12');
    expect(r?.noteId).toBe('6528abcd1234567890abcdef');
  });

  it('redirect 到 discovery/item/<hex> → 抽 noteId', async () => {
    mockFetchResponse('https://www.xiaohongshu.com/discovery/item/6528abcd1234567890abcdef');
    const r = await resolveXhsShortLink('https://xhslink.com/a/AbCd12');
    expect(r?.noteId).toBe('6528abcd1234567890abcdef');
  });

  it('final URL 不含 noteId 但 body 里有 → fallback 扫响应体', async () => {
    mockFetchResponse(
      'https://xhslink.com/a/AbCd12',
      '<html><script>window.__INITIAL__ = { url: "https://www.xiaohongshu.com/explore/6528abcd1234567890abcdef" }</script></html>',
    );
    const r = await resolveXhsShortLink('https://xhslink.com/a/AbCd12');
    expect(r?.noteId).toBe('6528abcd1234567890abcdef');
  });

  it('都拿不到 → null (不炸)', async () => {
    mockFetchResponse('https://xhslink.com/a/dead', '<html>nothing here</html>');
    const r = await resolveXhsShortLink('https://xhslink.com/a/dead');
    expect(r).toBeNull();
  });

  it('fetch 抛错 → null', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network');
    }) as any;
    const r = await resolveXhsShortLink('https://xhslink.com/a/x');
    expect(r).toBeNull();
  });
});

describe('resolveDouyinShortLink — 兜底 regex 收窄', () => {
  it('finalUrl 是规范 douyin URL → 抽 aweme_id', async () => {
    mockFetchResponse('https://www.douyin.com/video/7234567890123456789');
    const r = await resolveDouyinShortLink('https://v.douyin.com/xxx');
    expect(r?.awemeId).toBe('7234567890123456789');
  });

  it('finalUrl 是 iesdouyin share/video 路径 → 抽 aweme_id', async () => {
    mockFetchResponse('https://www.iesdouyin.com/share/video/7234567890123456789/?u_code=x');
    const r = await resolveDouyinShortLink('https://v.douyin.com/xxx');
    expect(r?.awemeId).toBe('7234567890123456789');
  });

  it('body 里含 "aweme_id":"..." key → 抽出', async () => {
    mockFetchResponse(
      'https://v.douyin.com/xxx',
      '<html><script>window._ROUTER_DATA = {"aweme_id":"7234567890123456789","other":"x"}</script></html>',
    );
    const r = await resolveDouyinShortLink('https://v.douyin.com/xxx');
    expect(r?.awemeId).toBe('7234567890123456789');
  });

  it('body 里含 data-aweme-id="..." 也抽出', async () => {
    mockFetchResponse(
      'https://v.douyin.com/xxx',
      '<div data-aweme-id="7234567890123456789">x</div>',
    );
    const r = await resolveDouyinShortLink('https://v.douyin.com/xxx');
    expect(r?.awemeId).toBe('7234567890123456789');
  });

  it('回归: finalUrl 只是 tracking URL 含 15-25 位数字 → null (不再误抓)', async () => {
    // 之前 bare AWEME_ID_RE 会把 tracking id 当成 aweme_id 返回
    mockFetchResponse(
      'https://tracker.example.com/click?campaign=1234567890123456789&target=douyin',
    );
    const r = await resolveDouyinShortLink('https://v.douyin.com/xxx');
    expect(r).toBeNull();
  });

  it('回归: body 里只有裸 15-25 位数字 (非 aweme_id key) → null', async () => {
    mockFetchResponse(
      'https://v.douyin.com/xxx',
      '<html><meta name="analytics-token" content="1234567890123456789"/></html>',
    );
    const r = await resolveDouyinShortLink('https://v.douyin.com/xxx');
    expect(r).toBeNull();
  });
});
