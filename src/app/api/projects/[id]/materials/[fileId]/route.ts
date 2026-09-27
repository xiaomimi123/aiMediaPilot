import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { updateMaterialNote, deleteMaterial } from '@/lib/film/materials';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string; fileId: string } };

export async function PATCH(req: Request, { params }: Ctx) {
  const body = (await req.json().catch(() => ({}))) as { note?: unknown };
  if (typeof body.note !== 'string') return fail('说明要是文字', 400);
  try {
    await updateMaterialNote(prisma, params.id, params.fileId, body.note);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 404);
  }
  return ok({ id: params.fileId });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await deleteMaterial(prisma, params.id, params.fileId);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 404);
  }
  return ok({ id: params.fileId });
}
