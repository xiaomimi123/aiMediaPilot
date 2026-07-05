import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveXhsShortLink } from '@/lib/inspiration/short-link-resolver';

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
