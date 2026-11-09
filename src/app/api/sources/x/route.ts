import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { freshItems } from '@/lib/sources/fetch';

export const dynamic = 'force-dynamic';

/** 选题页「X 热帖」的候选: 近 3 天抓到的 X 原创热帖, 按浏览数排 */
export async function GET() {
  const now = new Date();
  const items = await freshItems(prisma, now, 3);
  return ok(items.filter((i) => i.provider === 'x').slice(0, 20));
}
