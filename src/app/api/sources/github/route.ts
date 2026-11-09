import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { freshItems } from '@/lib/sources/fetch';
import { fetchReadme } from '@/lib/sources/news';

export const dynamic = 'force-dynamic';

/** 选题页「开源快讯」的仓库候选: 近 3 天抓到的 GitHub 仓库, 按热度排 */
export async function GET() {
  const now = new Date();
  const items = await freshItems(prisma, now, 3);
  return ok(items.filter((i) => i.provider === 'github').slice(0, 20));
}
