import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { toMessageView } from '@/lib/project/view';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const t = await prisma.assistantThread.findUnique({ where: { id: params.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  if (!t) return fail('找不到这个对话', 404);
  return ok({ id: t.id, title: t.title, messages: t.messages.map(toMessageView) });
}
