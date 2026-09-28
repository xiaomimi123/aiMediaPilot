import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { enqueueAnalysis, isAnalysisActive } from '@/lib/benchmark/queue';
import { staleRunning } from '@/lib/benchmark/view';
import { createPrismaStore } from '@/lib/benchmark/store';
import { analyzeVideo } from '@/lib/benchmark/analyze';
import { createAnalyzeDeps } from '@/lib/benchmark/deps';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const v = await prisma.benchmarkVideo.findUnique({ where: { id: params.id } });
  if (!v) return fail('找不到这条作品', 404);
  // 另一个进程(每晚巡检)正在拆这条: 不重复拆
  const row = await createPrismaStore(prisma).getVideo(v.id);
  if (row && row.analysisStatus === 'running' && !staleRunning(row, isAnalysisActive(v.id))) return ok({ queued: false });
  const queued = enqueueAnalysis(v.id, async (id) => analyzeVideo(await createAnalyzeDeps(prisma), id));
  if (queued) await prisma.benchmarkVideo.update({ where: { id: v.id }, data: { analysisStatus: 'running', analysisError: null, analysisStartedAt: new Date() } });
  return ok({ queued });
}
