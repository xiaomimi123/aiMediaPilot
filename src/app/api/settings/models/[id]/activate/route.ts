import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { activateModel } from '@/lib/llm/providers';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await prisma.modelProvider.findUnique({ where: { id: params.id } }))) return fail('找不到这个模型', 404);
  await activateModel(prisma, params.id);
  return ok({ active: params.id });
}
