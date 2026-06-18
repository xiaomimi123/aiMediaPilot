/**
 * Parse Douyin video URL or share-text → aweme_id.
 *
 * Supported inputs:
 * - 完整 URL: https://www.douyin.com/video/7234567890123456789
 * - 带 query: https://www.douyin.com/video/7234567890123456789?modal_id=xxx
 * - 分享 URL: https://www.iesdouyin.com/share/video/7234567890123456789/
 * - 短链: https://v.douyin.com/<short-code>/ (需服务端解析)
 * - **抖音 APP 分享文本** (含 v.douyin.com 短链 + 其它垃圾文字)
 * - 纯 aweme_id: 7234567890123456789 (18-19 位数字)
 */

const AWEME_ID_RE = /(\d{15,25})/;

// 提取任意 douyin/iesdouyin URL — 用于从 share text 抽取
const DOUYIN_URL_RE =
  /https?:\/\/(?:v|www|m|share)\.douyin\.com\/\S+|https?:\/\/(?:www|m)\.iesdouyin\.com\/share\/(?:video|note)\/\d+\/?/i;

const SHORT_LINK_RE = /v\.douyin\.com\/[\w-]+/i;

export interface ParsedDouyinUrl {
  awemeId: string;          // 空字符串当 isShortLink=true (需服务端解析后才知道)
  canonicalUrl: string;
  isShortLink: boolean;
}

export function parseDouyinVideoUrl(input: string): ParsedDouyinUrl | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 1. 从任意文本里提取第一个 douyin URL (兼容 share text 格式)
  const urlMatch = trimmed.match(DOUYIN_URL_RE);
  const urlPart = urlMatch ? urlMatch[0].replace(/[,，。.;；)）]+$/, '') : trimmed;

  // 2. 短链 — 需要服务端解析
  if (SHORT_LINK_RE.test(urlPart)) {
    return {
      awemeId: '',
      canonicalUrl: urlPart,
      isShortLink: true,
    };
  }

  // 3. URL 含 aweme_id (canonical 或 share URL)
  if (/^https?:\/\//.test(urlPart)) {
    const m = urlPart.match(AWEME_ID_RE);
    if (!m) return null;
    const awemeId = m[1];
    return {
      awemeId,
      canonicalUrl: `https://www.douyin.com/video/${awemeId}`,
      isShortLink: false,
    };
  }

  // 4. 纯 aweme_id — 15-25 位数字 (整个输入就是数字)
  if (/^\d{15,25}$/.test(trimmed)) {
    return {
      awemeId: trimmed,
      canonicalUrl: `https://www.douyin.com/video/${trimmed}`,
      isShortLink: false,
    };
  }

  return null;
}
