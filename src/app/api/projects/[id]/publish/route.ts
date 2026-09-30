import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { loadPublishState } from '@/lib/retro/state';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = await loadPublishState(prisma, params.id);
  return s ? ok(s) : fail('找不到这个项目', 404);
}
