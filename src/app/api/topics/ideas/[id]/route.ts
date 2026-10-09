import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/api';
import { deleteIdea } from '@/lib/topics/daily';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await deleteIdea(prisma, params.id));
  } catch {
    return fail('点子不存在', 404);
  }
}
