import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { createPrismaStore } from '@/lib/benchmark/store';
import { isAnalysisActive } from '@/lib/benchmark/queue';
import { listQuery, staleRunning, toVideoView, STALE_MESSAGE } from '@/lib/benchmark/view';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const filter = new URL(req.url).searchParams.get('filter') === 'all' ? 'all' : 'hits';
  const store = createPrismaStore(prisma);
  const rows = await store.listVideos(listQuery(filter));
  const names = new Map((await store.listAccounts()).map((a) => [a.id, a.nickname]));
  for (const r of rows) {
    if (staleRunning(r, isAnalysisActive(r.id))) await store.updateVideo(r.id, { analysisStatus: 'failed', analysisError: STALE_MESSAGE });
  }
  return ok(rows.map((r) => toVideoView(r, names.get(r.accountId) ?? '', isAnalysisActive(r.id))));
}
