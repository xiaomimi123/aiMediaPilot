import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a) return fail('not found', 404);
  if (a.status === 'COMPLETED' || a.status === 'FAILED') return fail('已结束的任务无法取消', 400);
  await prisma.contentAnalysis.update({
    where: { id: params.id },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });
  return ok({ id: params.id });
}
