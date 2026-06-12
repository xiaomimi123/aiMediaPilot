import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { retroQueue } from '@/jobs/queue';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const analysis = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!analysis) return fail('not found', 404);
  if (!analysis.douyinAwemeId) return fail('请先填抖音链接', 400);
  if (analysis.retroStatus === 'RUNNING') return fail('复盘正在进行中,请先取消', 400);

  await prisma.contentAnalysis.update({
    where: { id: params.id },
    data: {
      retroStatus: 'SCHEDULED',
      retroErrorMessage: null,
      retroStartedAt: null,
      retroCompletedAt: null,
      retroReport: Prisma.JsonNull,
    },
  });

  await retroQueue.add(
    'retro',
    { analysisId: params.id },
    { delay: 0, jobId: `retro-${params.id}-now-${Date.now()}`, removeOnComplete: true, removeOnFail: { age: 7 * 86400, count: 100 } }
  );

  return ok({});
}
