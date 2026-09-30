import fs from 'node:fs/promises';
import path from 'node:path';

/** 用大号搜博主的每日上限(风控护栏); 计数存在 logs/ 下的小文件里, 不进库 */
export const SEARCH_DAILY_LIMIT = 10;

const today = (now: Date) => now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

async function readCount(file: string, now: Date): Promise<number> {
  const raw = await fs.readFile(file, 'utf8').catch(() => '');
  try {
    const s = JSON.parse(raw) as { date?: string; count?: number };
    return s.date === today(now) ? Number(s.count) || 0 : 0;
  } catch {
    return 0; // 文件不存在或损坏: 当作今天第一次
  }
}

/** 今天还剩几次 */
export async function peekDailyQuota(file: string, limit: number, now = new Date()): Promise<number> {
  return Math.max(0, limit - (await readCount(file, now)));
}

/** 占用一次; 超限返回 false */
export async function takeDailyQuota(file: string, limit: number, now = new Date()): Promise<boolean> {
  const count = await readCount(file, now);
  if (count >= limit) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ date: today(now), count: count + 1 }));
  return true;
}

export function takeSearchQuota(file = path.join(process.cwd(), 'logs', 'benchmark-search-quota.json'), now = new Date()): Promise<boolean> {
  return takeDailyQuota(file, SEARCH_DAILY_LIMIT, now);
}
