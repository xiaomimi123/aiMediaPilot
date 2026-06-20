import { describe, expect, it } from 'vitest';
import { parseDouyinVideoUrl, detectInspirationSource } from '@/lib/inspiration/url-parser';

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

  it('抖音 APP share 文本 (含短链 + 标题 + 垃圾文字)', () => {
    const shareText = '6.69 复制打开抖音，看看【灯下黑的作品】为什么进步一定伴随着负面情绪? # 心理学 # 成... https://v.douyin.com/JEXNRNoEuIY/ :2pm Jvs:/ Q@k.CU 04/19';
    const r = parseDouyinVideoUrl(shareText);
    expect(r).not.toBeNull();
    expect(r?.isShortLink).toBe(true);
    expect(r?.canonicalUrl).toBe('https://v.douyin.com/JEXNRNoEuIY/');
  });

  it('share 文本 含 canonical URL → 解出 aweme_id', () => {
    const shareText = '看看这个 https://www.douyin.com/video/7234567890123456789 太赞了';
    const r = parseDouyinVideoUrl(shareText);
    expect(r?.awemeId).toBe('7234567890123456789');
    expect(r?.isShortLink).toBe(false);
  });

  it('URL 末尾带中文标点 也能切掉', () => {
    const r = parseDouyinVideoUrl('看看 https://v.douyin.com/JEXNRNoEuIY/。 很棒');
    expect(r?.canonicalUrl).toBe('https://v.douyin.com/JEXNRNoEuIY/');
  });
});

describe('detectInspirationSource', () => {
  it('抖音 canonical URL → platform=douyin needsManualFetch=false', () => {
    const r = detectInspirationSource('https://www.douyin.com/video/7234567890123456789');
    expect(r?.platform).toBe('douyin');
    expect(r?.externalId).toBe('7234567890123456789');
    expect(r?.needsManualFetch).toBe(false);
  });

  it('抖音短链 → isShortLink=true', () => {
    const r = detectInspirationSource('https://v.douyin.com/JEXNRNoEuIY/');
    expect(r?.platform).toBe('douyin');
    expect(r?.isShortLink).toBe(true);
  });

  it('小红书 explore URL → platform=xiaohongshu needsManualFetch=true', () => {
    const r = detectInspirationSource('https://www.xiaohongshu.com/explore/65f8a1b2000000001234567890abcdef');
    expect(r?.platform).toBe('xiaohongshu');
    expect(r?.externalId).toBe('65f8a1b2000000001234567890abcdef');
    expect(r?.needsManualFetch).toBe(true);
  });

  it('小红书 discovery/item URL', () => {
    const r = detectInspirationSource('https://www.xiaohongshu.com/discovery/item/65f8a1b2000000001234567890abcdef');
    expect(r?.platform).toBe('xiaohongshu');
    expect(r?.externalId).toBe('65f8a1b2000000001234567890abcdef');
  });

  it('xhslink 短链 → 平台对 但 externalId 用 URL', () => {
    const r = detectInspirationSource('https://xhslink.com/abc123');
    expect(r?.platform).toBe('xiaohongshu');
    expect(r?.isShortLink).toBe(true);
    expect(r?.externalId).toContain('xhs:');
  });

  it('公众号 mp.weixin URL → platform=gongzhonghao', () => {
    const r = detectInspirationSource('https://mp.weixin.qq.com/s/Abc-Def_xyz123XYZ');
    expect(r?.platform).toBe('gongzhonghao');
    expect(r?.externalId).toBe('Abc-Def_xyz123XYZ');
    expect(r?.needsManualFetch).toBe(true);
  });

  it('公众号 含 share text 也能解', () => {
    const r = detectInspirationSource('看看这篇 https://mp.weixin.qq.com/s/Abc-Def_xyz123XYZ 很棒');
    expect(r?.platform).toBe('gongzhonghao');
  });

  it('完全不像任何平台 → null', () => {
    expect(detectInspirationSource('https://example.com/foo')).toBeNull();
  });
});
