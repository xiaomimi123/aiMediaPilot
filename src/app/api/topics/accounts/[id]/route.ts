import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { status } = (await req.json().catch(() => ({}))) as { status?: string };
  if (!['following', 'candidate', 'ignored'].includes(status ?? '')) return fail('状态不对', 400);
  const a = await prisma.benchmarkAccount.findUnique({ where: { id: params.id } });
  if (!a) return fail('找不到这个账号', 404);
  await prisma.benchmarkAccount.update({ where: { id: a.id }, data: { status } });
  return ok({ status });
}
