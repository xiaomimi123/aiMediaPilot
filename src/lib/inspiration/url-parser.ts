/**
 * 灵感库 URL / share-text 解析.
 *
 * Douyin (有 crawler): 复用 parseDouyinVideoUrl, 拿 aweme_id 走自动抓.
 * 小红书 / 公众号 (无 crawler): 只识别平台 + 提取唯一 id, 走 manualMetadata 手动 paste.
 */

const AWEME_ID_RE = /(\d{15,25})/;

const DOUYIN_URL_RE =
  /https?:\/\/(?:v|www|m|share)\.douyin\.com\/\S+|https?:\/\/(?:www|m)\.iesdouyin\.com\/share\/(?:video|note)\/\d+\/?/i;
const SHORT_LINK_RE = /v\.douyin\.com\/[\w-]+/i;

// XHS: xiaohongshu.com/explore/<24-hex> or /discovery/item/<24-hex>; xhslink.com/<short>
const XHS_URL_RE =
  /https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/[a-f0-9]{20,32}|https?:\/\/xhslink\.com\/\S+/i;
const XHS_NOTE_ID_RE = /xiaohongshu\.com\/(?:explore|discovery\/item)\/([a-f0-9]{20,32})/i;

// 公众号: mp.weixin.qq.com/s/<token> 或 /s?__biz=...
const GZH_URL_RE = /https?:\/\/mp\.weixin\.qq\.com\/s\/?\S*/i;
const GZH_PATH_RE = /mp\.weixin\.qq\.com\/s\/([A-Za-z0-9_-]{8,})/i;

export type InspirationPlatform = 'douyin' | 'xiaohongshu' | 'gongzhonghao';

export interface DetectedInspirationSource {
  platform: InspirationPlatform;
  externalId: string;            // douyin: aweme_id; xhs: note_id; gzh: s 路径 id
  canonicalUrl: string;
  isShortLink: boolean;          // 只对 douyin 有意义 (服务端 resolve)
  needsManualFetch: boolean;     // true → 无 crawler, 强制 manualMetadata
}

export interface ParsedDouyinUrl {
  awemeId: string;
  canonicalUrl: string;
  isShortLink: boolean;
}

// Backwards compatibility — Douyin-only legacy callers.
export function parseDouyinVideoUrl(input: string): ParsedDouyinUrl | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(DOUYIN_URL_RE);
  if (urlMatch) {
    const urlPart = urlMatch[0].replace(/[,，。.;；)）]+$/, '');
    if (SHORT_LINK_RE.test(urlPart)) {
      return { awemeId: '', canonicalUrl: urlPart, isShortLink: true };
    }
    const m = urlPart.match(AWEME_ID_RE);
    if (!m) return null;
    return {
      awemeId: m[1],
      canonicalUrl: `https://www.douyin.com/video/${m[1]}`,
      isShortLink: false,
    };
  }

  // 不含 douyin URL → 只接受纯数字 aweme_id (兼容直接粘 id 的用法)
  if (/^\d{15,25}$/.test(trimmed)) {
    return {
      awemeId: trimmed,
      canonicalUrl: `https://www.douyin.com/video/${trimmed}`,
      isShortLink: false,
    };
  }

  return null;
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[,，。.;；)）]+$/, '');
}

export function detectInspirationSource(input: string): DetectedInspirationSource | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 1. Douyin (含 share-text + 短链 + 纯数字 id)
  const dy = parseDouyinVideoUrl(trimmed);
  if (dy) {
    return {
      platform: 'douyin',
      externalId: dy.awemeId,
      canonicalUrl: dy.canonicalUrl,
      isShortLink: dy.isShortLink,
      needsManualFetch: false,
    };
  }

  // 2. 小红书
  const xhsMatch = trimmed.match(XHS_URL_RE);
  if (xhsMatch) {
    const url = stripTrailingPunct(xhsMatch[0]);
    const noteIdMatch = url.match(XHS_NOTE_ID_RE);
    return {
      platform: 'xiaohongshu',
      externalId: noteIdMatch ? noteIdMatch[1] : `xhs:${url}`, // 短链或异常 URL → 用 url 当 id
      canonicalUrl: url,
      isShortLink: /xhslink\.com/i.test(url),
      needsManualFetch: true,
    };
  }

  // 3. 公众号
  const gzhMatch = trimmed.match(GZH_URL_RE);
  if (gzhMatch) {
    const url = stripTrailingPunct(gzhMatch[0]);
    const pathMatch = url.match(GZH_PATH_RE);
    return {
      platform: 'gongzhonghao',
      externalId: pathMatch ? pathMatch[1] : `gzh:${url}`,
      canonicalUrl: url,
      isShortLink: false,
      needsManualFetch: true,
    };
  }

  return null;
}
