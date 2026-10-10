import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/api';
import { deleteSample } from '@/lib/voice/samples';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await deleteSample(prisma, params.id));
  } catch {
    return fail('样本不存在', 404);
  }
}
