import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { enqueueAnalysis } from '@/lib/benchmark/queue';
import { analyzeVideo } from '@/lib/benchmark/analyze';
import { createAnalyzeDeps } from '@/lib/benchmark/deps';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const v = await prisma.benchmarkVideo.findUnique({ where: { id: params.id } });
  if (!v) return fail('找不到这条作品', 404);
  const queued = enqueueAnalysis(v.id, async (id) => analyzeVideo(await createAnalyzeDeps(prisma), id));
  if (queued) await prisma.benchmarkVideo.update({ where: { id: v.id }, data: { analysisStatus: 'running', analysisError: null } });
  return ok({ queued });
}
