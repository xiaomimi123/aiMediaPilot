/**
 * Parse Douyin video URL → aweme_id.
 *
 * Supported formats:
 * - https://www.douyin.com/video/7234567890123456789
 * - https://www.douyin.com/video/7234567890123456789?modal_id=xxx
 * - https://www.iesdouyin.com/share/video/7234567890123456789/
 * - https://v.douyin.com/<short-code>/  (短链 — 暂不解析, 由 cheat 重定向后再处理)
 * - 7234567890123456789 (raw aweme_id, 18-19 位数字)
 */

const AWEME_ID_RE = /(\d{15,25})/;

export interface ParsedDouyinUrl {
  awemeId: string;
  canonicalUrl: string;
  isShortLink: boolean;  // true 表示 v.douyin.com 短链, 需要后端解析
}

export function parseDouyinVideoUrl(input: string): ParsedDouyinUrl | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // 1. 短链 — v.douyin.com/xxx
  if (/v\.douyin\.com\/\w+/.test(trimmed)) {
    return {
      awemeId: '',
      canonicalUrl: trimmed,
      isShortLink: true,
    };
  }

  // 2. 完整 URL — 提取 aweme_id 数字段
  if (/^https?:\/\//.test(trimmed)) {
    const m = trimmed.match(AWEME_ID_RE);
    if (!m) return null;
    const awemeId = m[1];
    return {
      awemeId,
      canonicalUrl: `https://www.douyin.com/video/${awemeId}`,
      isShortLink: false,
    };
  }

  // 3. 纯 aweme_id — 15-25 位数字
  if (/^\d{15,25}$/.test(trimmed)) {
    return {
      awemeId: trimmed,
      canonicalUrl: `https://www.douyin.com/video/${trimmed}`,
      isShortLink: false,
    };
  }

  return null;
}
