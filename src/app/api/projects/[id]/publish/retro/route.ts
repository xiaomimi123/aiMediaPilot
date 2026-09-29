import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { createRetroDeps, generateRetro } from '@/lib/retro/generate';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const r = await generateRetro(await createRetroDeps(prisma), params.id);
  return r.ok ? ok({ done: true }) : fail(r.reason, 400);
}
