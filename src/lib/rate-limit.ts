/**
 * 极轻量进程内限流。 用于防止 client 绕开前端 debounce 直接刷 LLM 端点。
 *
 * 不适合分布式生产 (每 worker 独立 Map, 不共享),
 * 但对单用户 MVP + Next.js 单 process 场景够用。
 *
 * 算法: 简单固定窗口 — 每个 key 在 windowMs 内只允许 limit 次。
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetInMs: number;
}

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  const bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const fresh: Bucket = { count: 1, resetAt: now + opts.windowMs };
    store.set(key, fresh);
    return { ok: true, remaining: opts.limit - 1, resetInMs: opts.windowMs };
  }
  if (bucket.count >= opts.limit) {
    return { ok: false, remaining: 0, resetInMs: bucket.resetAt - now };
  }
  bucket.count += 1;
  return {
    ok: true,
    remaining: opts.limit - bucket.count,
    resetInMs: bucket.resetAt - now,
  };
}

/** 从 Request 拿一个稳定的限流 key。 优先信任 x-forwarded-for 首段, 否则 fallback 到 'anon'。 */
export function ipKey(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'anon';
}

/** 测试用。 */
export function __resetRateLimitForTest(): void {
  store.clear();
}
