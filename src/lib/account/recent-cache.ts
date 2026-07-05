/**
 * account/recent 路由的进程内 60s cache。 拆到独立 module 是因为
 * Next.js 的 route.ts 只允许 export HTTP handler + Next 保留字段;
 * 但测试需要 reset cache, 所以把状态 + reset 都放到这里, route 只 import。
 *
 * 只缓存成功的抓取结果 (videos: T[]) — null (登录过期) 不写, 避免 60s 窗口静默藏错。
 */

interface CacheEntry<T> {
  fetchedAt: number;
  videos: T;
}

let entry: CacheEntry<unknown> | null = null;
const CACHE_TTL_MS = 60_000;

export function getRecentCache<T>(): CacheEntry<T> | null {
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt >= CACHE_TTL_MS) return null;
  return entry as CacheEntry<T>;
}

export function setRecentCache<T>(videos: T): number {
  const fetchedAt = Date.now();
  entry = { fetchedAt, videos };
  return fetchedAt;
}

/** 测试用 — 清缓存。 */
export function __resetRecentCache(): void {
  entry = null;
}
