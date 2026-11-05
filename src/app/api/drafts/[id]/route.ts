import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { deleteDraft, getDraft, updateDraft } from '@/lib/draft/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const d = await getDraft(prisma, params.id);
  if (!d) return fail('草稿不存在', 404);
  return ok(d);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const b = (await req.json().catch(() => ({}))) as { title?: string; body?: string; status?: string };
  try {
    const d = await updateDraft(prisma, params.id, b);
    if (!d) return fail('草稿不存在', 404);
    return ok(d);
  } catch {
    return fail('保存失败', 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await deleteDraft(prisma, params.id));
  } catch {
    return fail('草稿不存在', 404);
  }
}
