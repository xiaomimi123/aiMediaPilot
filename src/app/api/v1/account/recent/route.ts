import { ok, fail } from '@/lib/api';
import { fetchAccountRecentVideos } from '@/lib/account/recent-videos-adapter';

// 60s 内重复请求复用上次结果, 防 Playwright 重复启动
let cache: { fetchedAt: number; videos: Awaited<ReturnType<typeof fetchAccountRecentVideos>> } | null = null;
const CACHE_TTL_MS = 60_000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 10));

  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return ok({ videos: cache.videos ?? [], cached: true, fetchedAt: new Date(cache.fetchedAt).toISOString() });
  }

  try {
    const videos = await fetchAccountRecentVideos(limit);
    cache = { fetchedAt: Date.now(), videos };
    if (!videos) {
      return fail('抓取失败 — 可能登录态过期, 请先在 cheat 端 login', 502);
    }
    return ok({ videos, cached: false, fetchedAt: new Date(cache.fetchedAt).toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[GET account/recent]', e);
    return fail(`抓取异常: ${msg}`, 500);
  }
}
