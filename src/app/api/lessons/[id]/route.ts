import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { updateLesson } from '@/lib/retro/lessons';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { status?: string; text?: string };
  try {
    return ok(await updateLesson(prisma, params.id, body));
  } catch (e) {
    const m = e instanceof Error ? e.message : '更新失败';
    return fail(m, m === '找不到这条经验' ? 404 : 400);
  }
}
