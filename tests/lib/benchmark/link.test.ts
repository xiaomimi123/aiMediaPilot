import { describe, expect, it, vi } from 'vitest';
import { extractUrl, parseTarget, resolveLink } from '@/lib/benchmark/link';

describe('link parsing', () => {
  it('extracts the url from a share text', () => {
    expect(extractUrl('7.43 复制打开抖音，看看【园长说AI的作品】画面都交给AI了 https://v.douyin.com/iAbCdEf/ Z@m.Dh 08/12 xyz:/')).toBe('https://v.douyin.com/iAbCdEf/');
    expect(extractUrl('没有链接')).toBeNull();
  });
  it('recognizes video and user urls', () => {
    expect(parseTarget('https://www.douyin.com/video/7676819001574157481?previous_page=x')).toEqual({ kind: 'video', awemeId: '7676819001574157481' });
    expect(parseTarget('https://www.iesdouyin.com/share/video/7676819001574157481/?region=CN')).toEqual({ kind: 'video', awemeId: '7676819001574157481' });
    expect(parseTarget('https://www.douyin.com/jingxuan?modal_id=7676819001574157481')).toEqual({ kind: 'video', awemeId: '7676819001574157481' });
    expect(parseTarget('https://www.douyin.com/user/MS4wLjABAAAAo9jpySaV-_x?from_tab_name=main')).toEqual({ kind: 'user', secUid: 'MS4wLjABAAAAo9jpySaV-_x' });
    expect(parseTarget('https://www.bilibili.com/video/BV1')).toBeNull();
  });
  it('follows a short link redirect', async () => {
    const fetcher = vi.fn(async () => ({ status: 302, headers: new Headers({ location: 'https://www.iesdouyin.com/share/video/7676819001574157481/?region=CN' }) }));
    expect(await resolveLink('看看 https://v.douyin.com/iAbCdEf/', fetcher as unknown as typeof fetch)).toEqual({ kind: 'video', awemeId: '7676819001574157481' });
  });
  it('returns null for non-douyin text', async () => {
    expect(await resolveLink('https://example.com/a')).toBeNull();
  });
});
