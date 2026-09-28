export type LinkTarget = { kind: 'video'; awemeId: string } | { kind: 'user'; secUid: string };

/** 抖音复制出来的分享文本夹着中文和口令, 只取第一个 http(s) 链接 */
export function extractUrl(text: string): string | null {
  const m = /https?:\/\/[^\s，。！？、"'<>]+/.exec(text);
  return m ? m[0] : null;
}

export function parseTarget(url: string): LinkTarget | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)(douyin|iesdouyin)\.com$/.test(u.hostname)) return null;
  const video = /\/(?:share\/)?(?:video|note)\/(\d{8,})/.exec(u.pathname)?.[1] ?? u.searchParams.get('modal_id') ?? u.searchParams.get('vid');
  if (video && /^\d{8,}$/.test(video)) return { kind: 'video', awemeId: video };
  const user = /\/(?:share\/)?user\/(MS4w[\w-]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get('sec_uid');
  if (user && /^MS4w[\w-]+$/.test(user)) return { kind: 'user', secUid: user };
  return null;
}

/** v.douyin.com 短链只会 302 到真实地址, 不需要登录, 所以不走浏览器 */
export async function resolveLink(text: string, fetcher: typeof fetch = fetch): Promise<LinkTarget | null> {
  let url = extractUrl(text);
  for (let hop = 0; url && hop < 4; hop++) {
    const direct = parseTarget(url);
    if (direct) return direct;
    if (!/(^|\.)douyin\.com$/.test(new URL(url).hostname)) return null;
    const res = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const next = res.headers.get('location');
    if (!next) return null;
    url = new URL(next, url).toString();
  }
  return null;
}
