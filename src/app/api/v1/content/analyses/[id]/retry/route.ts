import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { analyzeQueue } from '@/jobs/queue';
import { getOrCreateDefaultUser } from '@/lib/user';

const MAX_RETRIES = 3;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a || a.userId !== user.id) return fail('not found', 404);
  if (a.status !== 'FAILED') return fail('仅 FAILED 状态可重试', 400);
  if (a.retryCount >= MAX_RETRIES) return fail(`已达重试上限 ${MAX_RETRIES} 次`, 400);

  await prisma.contentAnalysis.update({
    where: { id: params.id },
    data: {
      status: 'QUEUED',
      errorMessage: null,
      retryCount: { increment: 1 },
      startedAt: null,
      completedAt: null,
    },
  });

  await analyzeQueue.add(
    'analyze',
    { analysisId: a.id },
    { jobId: `analyze-${a.id}-retry-${a.retryCount + 1}`, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600, count: 100 } }
  );

  return ok({ id: params.id, retryCount: a.retryCount + 1 });
}
