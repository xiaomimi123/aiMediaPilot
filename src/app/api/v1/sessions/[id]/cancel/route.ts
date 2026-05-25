import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const s = await prisma.browserSession.findUnique({ where: { id: params.id } });
  if (!s) return fail('session not found', 404);
  await prisma.browserSession.update({ where: { id: params.id }, data: { status: 'EXPIRED' } });
  return ok({ id: params.id });
}
