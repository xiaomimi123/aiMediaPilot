import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { deleteModel, ModelInputSchema, toModelView, updateModel } from '@/lib/llm/providers';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const p = ModelInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return fail(p.error.issues[0]?.message ?? '填写不完整', 400);
  if (!(await prisma.modelProvider.findUnique({ where: { id: params.id } }))) return fail('找不到这个模型', 404);
  return ok(toModelView(await updateModel(prisma, params.id, p.data)));
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await prisma.modelProvider.findUnique({ where: { id: params.id } }))) return fail('找不到这个模型', 404);
  await deleteModel(prisma, params.id);
  return ok({ deleted: true });
}
