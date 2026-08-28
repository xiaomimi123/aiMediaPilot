import { headers } from 'next/headers';

/**
 * 设置页统一的服务端取数。
 *
 * 走自己的 HTTP API 而不是直接读库: 这些档案的读写形状由路由定义(默认值补全、
 * 加密字段掩码、established 派生), 页面直接读库等于把那套逻辑再抄一遍, 两边
 * 一定会漂移。
 */
export async function loadJson<T>(path: string): Promise<T | null> {
  const h = await headers();
  const base = `http://${h.get('host') ?? 'localhost:3000'}`;
  try {
    const res = await fetch(`${base}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.success ? (body.data as T) : null;
  } catch {
    return null;
  }
}
