import { ok, fail } from '@/lib/api';
import { fetchAccountRecentVideos } from '@/lib/account/recent-videos-adapter';
import { getRecentCache, setRecentCache } from '@/lib/account/recent-cache';

type FetchedVideos = NonNullable<Awaited<ReturnType<typeof fetchAccountRecentVideos>>>;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 10));

  if (!force) {
    const cached = getRecentCache<FetchedVideos>();
    if (cached) {
      return ok({
        videos: cached.videos,
        cached: true,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
      });
    }
  }

  try {
    const videos = await fetchAccountRecentVideos(limit);
    if (!videos) {
      // 之前 cache 在 null-check 前写入 → 后续 60s 的请求走 cache hit,
      // 返回 { videos: [], cached: true } + 200, 掩盖登录过期错误。
      return fail('抓取失败 — 可能登录态过期, 请先在 cheat 端 login', 502);
    }
    const fetchedAt = setRecentCache(videos);
    return ok({ videos, cached: false, fetchedAt: new Date(fetchedAt).toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[GET account/recent]', e);
    return fail(`抓取异常: ${msg}`, 500);
  }
}
