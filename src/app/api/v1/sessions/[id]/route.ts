import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const s = await prisma.browserSession.findUnique({ where: { id: params.id } });
  if (!s) return fail('session not found', 404);
  return ok({
    id: s.id,
    platform: s.platform,
    status: s.status,
    accountId: s.accountId,
    expiresAt: s.expiresAt,
  });
}
