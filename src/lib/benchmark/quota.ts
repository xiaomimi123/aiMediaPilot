import fs from 'node:fs/promises';
import path from 'node:path';

/** 用大号搜博主的每日上限(风控护栏); 计数存在 logs/ 下的小文件里, 不进库 */
export const SEARCH_DAILY_LIMIT = 10;

export async function takeSearchQuota(file = path.join(process.cwd(), 'logs', 'benchmark-search-quota.json'), now = new Date()): Promise<boolean> {
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const raw = await fs.readFile(file, 'utf8').catch(() => '');
  let state = { date: today, count: 0 };
  try {
    const s = JSON.parse(raw) as { date?: string; count?: number };
    if (s.date === today) state = { date: today, count: Number(s.count) || 0 };
  } catch {
    /* 文件不存在或损坏: 当作今天第一次 */
  }
  if (state.count >= SEARCH_DAILY_LIMIT) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ date: today, count: state.count + 1 }));
  return true;
}
