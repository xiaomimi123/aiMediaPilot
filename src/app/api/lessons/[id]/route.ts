import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { toLessonView } from '@/lib/retro/view';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { status?: string; text?: string };
  const l = await prisma.writingLesson.findUnique({ where: { id: params.id } });
  if (!l) return fail('找不到这条经验', 404);
  if (body.status && !['active', 'retired', 'rejected'].includes(body.status)) return fail('状态不对', 400);
  const text = typeof body.text === 'string' ? body.text.trim() : undefined;
  if (text !== undefined && (text.length < 4 || text.length > 80)) return fail('经验写成一句话（4～80 字）', 400);
  const row = await prisma.writingLesson.update({
    where: { id: l.id },
    data: {
      ...(text !== undefined ? { text } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.status === 'active' ? { confirmedAt: new Date(), contradicted: false } : {}),
    },
  });
  return ok(toLessonView(row));
}
