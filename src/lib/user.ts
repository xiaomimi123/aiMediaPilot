import { prisma } from './prisma';
import type { User } from '@prisma/client';

const DEFAULT_USER_ID = 'default-user';

/**
 * 单用户 MVP: 始终使用同一条 User 记录, 首次访问时自动创建。
 *
 * 优化前 — 每次调用都 upsert, 热路径 (~38 处调用 × 每次页面/API 请求) 无谓写 DB。
 * 优化后 — Promise 级 memoize: 首次 upsert 成功后, 后续所有调用直接 resolve 缓存 Promise。
 * 出错时清缓存, 允许下一次调用重试。
 *
 * ⚠️ 缓存的是 upsert 那一刻的 User 快照;
 * baselinePlays / lastAutoSyncAt 后续被别处 update 后, 缓存里的字段是老的。
 * 现有调用点只用 `.id`, 需要新鲜字段的地方独自 `prisma.user.findUnique`。
 */
let cachedUserPromise: Promise<User> | null = null;

export async function getOrCreateDefaultUser(): Promise<User> {
  if (cachedUserPromise) return cachedUserPromise;
  cachedUserPromise = prisma.user
    .upsert({
      where: { id: DEFAULT_USER_ID },
      update: {},
      create: { id: DEFAULT_USER_ID, name: 'MediaPilot User' },
    })
    .catch((err) => {
      // 失败时清缓存, 下次调用再试, 而不是永远 reject 同一个 promise
      cachedUserPromise = null;
      throw err;
    });
  return cachedUserPromise;
}

/**
 * 只拿 default user 的 id — 比 getOrCreateDefaultUser 更快,
 * 首次会走 upsert, 之后走内存返回。 只需要 id 时优先用这个。
 */
export async function getDefaultUserId(): Promise<string> {
  const u = await getOrCreateDefaultUser();
  return u.id;
}

/** 测试用 — 清缓存, 保证 test isolation。 */
export function __resetUserCacheForTest(): void {
  cachedUserPromise = null;
}
