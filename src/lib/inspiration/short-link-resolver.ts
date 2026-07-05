/**
 * Resolve v.douyin.com / xhslink.com short link → canonical aweme_id / note_id.
 *
 * Strategy: HTTP fetch with redirect:'follow', then extract id from final URL.
 * v.douyin.com typically redirects to https://www.iesdouyin.com/share/video/<id>/...
 * xhslink.com typically redirects to https://www.xiaohongshu.com/explore/<24-hex>...
 */

const AWEME_ID_RE = /(\d{15,25})/;
const XHS_NOTE_ID_RE = /xiaohongshu\.com\/(?:explore|discovery\/item)\/([a-f0-9]{20,32})/i;

export interface ResolvedShortLink {
  awemeId: string;
  finalUrl: string;
}

export interface ResolvedXhsShortLink {
  noteId: string;
  finalUrl: string;
}

export async function resolveDouyinShortLink(shortUrl: string): Promise<ResolvedShortLink | null> {
  try {
    const res = await fetch(shortUrl, {
      method: 'GET',
      // Important: Douyin checks UA. Use a real desktop browser UA.
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });

    // After redirects, res.url is the final destination
    const finalUrl = res.url;
    const m = finalUrl.match(AWEME_ID_RE);
    if (m) {
      return { awemeId: m[1], finalUrl };
    }

    // Some 抖音 short links return HTML with the canonical URL embedded.
    // As a fallback, scan response body for aweme_id pattern in window._ROUTER_DATA or similar.
    try {
      const text = await res.text();
      const m2 = text.match(/"aweme_id"\s*:\s*"?(\d{15,25})"?/) ?? text.match(AWEME_ID_RE);
      if (m2) return { awemeId: m2[1], finalUrl };
    } catch {
      // body read failed, continue to return null
    }

    return null;
  } catch (e) {
    console.error('[resolveDouyinShortLink]', e);
    return null;
  }
}

/**
 * Resolve xhslink.com short → canonical xiaohongshu.com/explore/<24-hex>。
 *
 * 之前的问题: xhslink 短链的 externalId 用了 `xhs:<原URL>`, 用户后来又粘规范
 * URL, `explore/<hex>` 提出的 noteId 就是不同 externalId, unique 约束绕过,
 * 同一条笔记被存 2 行。 现在: POST 时先 resolve 拿 noteId, 落库时 externalId
 * 用真 noteId, 两次 paste 命中同一条 unique row。
 */
export async function resolveXhsShortLink(shortUrl: string): Promise<ResolvedXhsShortLink | null> {
  try {
    const res = await fetch(shortUrl, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });

    const finalUrl = res.url;
    const m = finalUrl.match(XHS_NOTE_ID_RE);
    if (m) return { noteId: m[1], finalUrl };

    // fallback: xhslink 有时返回 HTML meta refresh 而非 30x, 扫响应体
    try {
      const text = await res.text();
      const m2 = text.match(XHS_NOTE_ID_RE);
      if (m2) return { noteId: m2[1], finalUrl };
    } catch {
      // body read failed
    }

    return null;
  } catch (e) {
    console.error('[resolveXhsShortLink]', e);
    return null;
  }
}
