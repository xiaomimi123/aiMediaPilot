import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { status } = (await req.json().catch(() => ({}))) as { status?: string };
  if (status !== 'seen' && status !== 'ignored') return fail('只能标记为已看或忽略', 400);
  const v = await prisma.benchmarkVideo.findUnique({ where: { id: params.id } });
  if (!v) return fail('找不到这条作品', 404);
  // 已建项目的作品不因为"看过"而降级
  if (!(status === 'seen' && v.status === 'adopted')) await prisma.benchmarkVideo.update({ where: { id: v.id }, data: { status } });
  return ok({ status });
}
