import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { toProjectView } from '@/lib/project/view';
import { loadProjectBundle } from '@/lib/project/load';
import { ScriptSchema } from '@/lib/script/model';
import { applySegmentEdit } from '@/lib/script/edit';
import { finalizeScript } from '@/lib/script/finalize';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const bundle = await loadProjectBundle(prisma, params.id);
  if (!bundle) return fail('项目不存在或已删除', 404);
  return ok(bundle);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    finalize?: boolean;
    edit?: { segmentId: string; text: string };
  };
  const p = await prisma.project.findUnique({ where: { id: params.id } });
  if (!p) return fail('项目不存在或已删除', 404);

  const data: Prisma.ProjectUpdateInput = {};
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim();

  if (body.edit) {
    const parsed = ScriptSchema.safeParse(p.script);
    if (!parsed.success) return fail('还没有稿子，先让编导写一版', 400);
    try {
      data.script = applySegmentEdit(parsed.data, body.edit.segmentId, body.edit.text) as unknown as Prisma.InputJsonValue;
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e), 400);
    }
  }

  if (body.finalize && !ScriptSchema.safeParse(p.script).success) return fail('还没有稿子，不能定稿', 400);
  let updated = await prisma.project.update({ where: { id: p.id }, data });
  if (body.finalize) updated = await finalizeScript(prisma, p.id);
  return ok(toProjectView(updated));
}
