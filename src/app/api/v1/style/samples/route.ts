import { ok } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const PREVIEW_LEN = 200;

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const samples = await prisma.styleSample.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });

  return ok({
    samples: samples.map((s) => ({
      id: s.id,
      platform: s.platform,
      preview: s.content.slice(0, PREVIEW_LEN),
      createdAt: s.createdAt,
    })),
  });
}
