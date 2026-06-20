import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const item = await prisma.inspirationInsight.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true, videoIds: true, output: true, generatedAt: true },
  });
  if (!item) return fail('insight 不存在或不属于你', 404);
  return ok({
    id: item.id,
    videoIds: item.videoIds,
    output: item.output,
    generatedAt: item.generatedAt.toISOString(),
  });
}
