import { ok } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const items = await prisma.inspirationInsight.findMany({
    where: { userId: user.id },
    orderBy: { generatedAt: 'desc' },
    take: 30,
    select: {
      id: true,
      videoIds: true,
      output: true,
      generatedAt: true,
    },
  });
  return ok({
    items: items.map((i) => ({
      id: i.id,
      videoIds: i.videoIds,
      output: i.output,
      generatedAt: i.generatedAt.toISOString(),
    })),
  });
}
