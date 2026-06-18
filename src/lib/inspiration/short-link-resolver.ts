/**
 * Resolve v.douyin.com short link → canonical aweme_id.
 *
 * Strategy: HTTP fetch with redirect:'follow', then extract aweme_id from final URL.
 * v.douyin.com typically redirects to https://www.iesdouyin.com/share/video/<id>/...
 */

const AWEME_ID_RE = /(\d{15,25})/;

export interface ResolvedShortLink {
  awemeId: string;
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
