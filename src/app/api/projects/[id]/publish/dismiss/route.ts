import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { dismissWork } from '@/lib/retro/match';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { workId } = (await req.json().catch(() => ({}))) as { workId?: string };
  if (typeof workId !== 'string') return fail('没指定作品', 400);
  await dismissWork(prisma, workId);
  return ok({ dismissed: true });
}
