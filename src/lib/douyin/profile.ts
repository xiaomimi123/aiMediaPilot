import type { PrismaClient } from '@prisma/client';
import { parseProfile } from '@/lib/benchmark/parse';

/**
 * 自己账号的粉丝/获赞/作品数, 取自抖音网页版「我的资料」(profile/self), 与主页显示一致。
 * 不用创作者后台「数据概览」里叫 fans 的那项 —— 它不是粉丝数(2026-09-28 实测 2847, 真实粉丝 408)。
 */
export const PROFILE_METRICS = {
  followers: 'profile_followers',
  totalLikes: 'profile_total_favorited',
  awemeCount: 'profile_aweme_count',
} as const;

export interface SelfProfile {
  followers: number;
  totalLikes: number;
  awemeCount: number;
}

export function parseSelfProfile(json: unknown): SelfProfile {
  const p = parseProfile(json);
  const awemeCount = Number((json as { user?: { aweme_count?: unknown } }).user?.aweme_count) || 0;
  return { followers: p.followers, totalLikes: p.totalLikes, awemeCount };
}

/** 在已登录的 douyin.com 页面里读「我的资料」, 输出 @@RESULT@@ 行(只读) */
export const SELF_PROFILE_SCRIPT = `
const task = await taskSpace('抖音账号资料')
const p = task.page('p1')
await p.goto('https://www.douyin.com/', { timeout: 30000 })
await new Promise((r) => setTimeout(r, 2500))
const r = await p.fetch('https://www.douyin.com/aweme/v1/web/user/profile/self/?device_platform=webapp&aid=6383&channel=channel_pc_web', { credentials: 'include', timeout: 20000 })
cliLog('@@RESULT@@' + JSON.stringify({ status: r.status, body: r.body }))
`;

/** 存为当前值; lastPeriodIncr = 与上次回采相比的变化 */
export async function saveSelfProfile(db: PrismaClient, p: SelfProfile): Promise<void> {
  const values: [string, number][] = [
    [PROFILE_METRICS.followers, p.followers],
    [PROFILE_METRICS.totalLikes, p.totalLikes],
    [PROFILE_METRICS.awemeCount, p.awemeCount],
  ];
  for (const [metric, currentCount] of values) {
    const prev = await db.douyinMetricSummary.findUnique({ where: { metric } });
    const lastPeriodIncr = prev ? currentCount - prev.currentCount : 0;
    await db.douyinMetricSummary.upsert({
      where: { metric },
      update: { currentCount, lastPeriodIncr, fetchedAt: new Date() },
      create: { metric, currentCount, lastPeriodIncr },
    });
  }
}
