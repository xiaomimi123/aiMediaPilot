const LONG_URL_REGEX = /douyin\.com\/video\/(\d+)/;

/** 从抖音长链 (含 douyin.com/video/<digits>) 提取 aweme_id。失败返回 null。 */
export function extractAwemeIdFromLongUrl(url: string): string | null {
  const m = LONG_URL_REGEX.exec(url);
  return m ? m[1] : null;
}

export interface ResolveOptions {
  timeoutMs?: number;
  /** 注入 fetch 便于测试 */
  fetch?: typeof globalThis.fetch;
}

/**
 * 解析任意抖音视频 URL (长链 / 短链 v.douyin.com/<slug>) 为 aweme_id。
 * 短链走 HEAD 请求拿 Location header。 超时 / 解析失败返回 null。
 */
export async function resolveDouyinUrl(url: string, opts: ResolveOptions = {}): Promise<string | null> {
  const direct = extractAwemeIdFromLongUrl(url);
  if (direct) return direct;

  if (!/v\.douyin\.com/.test(url)) return null;

  const timeoutMs = opts.timeoutMs ?? 3000;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetchImpl(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
    });
    const location = resp.headers.get('location');
    if (!location) return null;
    return extractAwemeIdFromLongUrl(location);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
