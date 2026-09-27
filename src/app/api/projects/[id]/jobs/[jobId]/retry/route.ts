import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { findActiveJob } from '@/lib/jobs/runner';
import { launchJob, isJobKind } from '@/lib/jobs/registry';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string; jobId: string } }) {
  const job = await prisma.job.findFirst({ where: { id: params.jobId, projectId: params.id } });
  if (!job) return fail('任务不存在', 404);
  if (!['failed', 'interrupted'].includes(job.status)) return fail('这个任务没有失败，不需要重试', 400);
  if (!isJobKind(job.kind)) return fail('这种任务已经不支持了', 400);
  if (await findActiveJob(prisma, params.id, job.kind)) return fail('已经有一个同类任务在跑了', 409);
  const { jobId } = await launchJob(prisma, params.id, job.kind);
  return ok({ jobId });
}
