import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { ok, fail } from '@/lib/api';

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getOrCreateDefaultUser();
  const existing = await prisma.aIConfig.findUnique({ where: { id: params.id } });
  if (!existing || existing.userId !== user.id) {
    return fail('配置不存在', 404);
  }
  await prisma.aIConfig.delete({ where: { id: params.id } });
  return ok({ id: params.id });
}
