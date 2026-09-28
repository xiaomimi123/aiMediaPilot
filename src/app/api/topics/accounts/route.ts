import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { createPrismaStore } from '@/lib/benchmark/store';
import { toAccountView } from '@/lib/benchmark/view';

export const dynamic = 'force-dynamic';

export async function GET() {
  const store = createPrismaStore(prisma);
  const all = await store.listAccounts();
  const lastHits = await prisma.benchmarkVideo.groupBy({ by: ['accountId'], where: { hitAt: { not: null } }, _max: { hitAt: true } });
  const hitMap = new Map(lastHits.map((h) => [h.accountId, h._max.hitAt]));
  const view = (status: string) => all.filter((a) => a.status === status).map((a) => toAccountView(a, hitMap.get(a.id) ?? null));
  return ok({ following: view('following'), candidates: view('candidate') });
}
