import { describe, expect, it } from 'vitest';
import { parseDouyinVideoUrl } from '@/lib/inspiration/url-parser';

describe('parseDouyinVideoUrl', () => {
  it('完整 douyin URL → 提取 aweme_id', () => {
    expect(parseDouyinVideoUrl('https://www.douyin.com/video/7234567890123456789')).toEqual({
      awemeId: '7234567890123456789',
      canonicalUrl: 'https://www.douyin.com/video/7234567890123456789',
      isShortLink: false,
    });
  });

  it('带 query 参数也能解析', () => {
    expect(parseDouyinVideoUrl('https://www.douyin.com/video/7234567890123456789?modal_id=xxx')).toEqual({
      awemeId: '7234567890123456789',
      canonicalUrl: 'https://www.douyin.com/video/7234567890123456789',
      isShortLink: false,
    });
  });

  it('iesdouyin 分享 URL → 提取', () => {
    const r = parseDouyinVideoUrl('https://www.iesdouyin.com/share/video/7234567890123456789/');
    expect(r?.awemeId).toBe('7234567890123456789');
  });

  it('v.douyin.com 短链 → 标记 isShortLink=true', () => {
    const r = parseDouyinVideoUrl('https://v.douyin.com/iA7yfRm/');
    expect(r?.isShortLink).toBe(true);
    expect(r?.canonicalUrl).toBe('https://v.douyin.com/iA7yfRm/');
  });

  it('纯 aweme_id 数字 → 接受', () => {
    expect(parseDouyinVideoUrl('7234567890123456789')).toEqual({
      awemeId: '7234567890123456789',
      canonicalUrl: 'https://www.douyin.com/video/7234567890123456789',
      isShortLink: false,
    });
  });

  it('空字符串 → null', () => {
    expect(parseDouyinVideoUrl('')).toBeNull();
  });

  it('完全不像 douyin URL → null', () => {
    expect(parseDouyinVideoUrl('https://example.com/video/123')).toBeNull();
  });

  it('短数字 (不像 aweme) → null', () => {
    expect(parseDouyinVideoUrl('12345')).toBeNull();
  });

  it('trim 空白', () => {
    expect(parseDouyinVideoUrl('  https://www.douyin.com/video/7234567890123456789  ')?.awemeId).toBe('7234567890123456789');
  });
});
