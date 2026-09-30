import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { launchJob, type JobKind } from '@/lib/jobs/registry';
import { PUBLISHED_REFUSAL } from '@/lib/predict/run';
import { toPredictionView, type PredictionView } from '@/lib/predict/view';

export const dynamic = 'force-dynamic';

export interface PredictionsData {
  latest: PredictionView | null;
  final: PredictionView | null;
  recorded: PredictionView | null;
  running: boolean;
  published: boolean;
  canLockFinal: boolean;
  canLockRecorded: boolean;
}

const KINDS = ['draft', 'final', 'recorded'] as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, stage: true } });
  if (!p) return fail('项目不存在或已删除', 404);
  const latestOf = async (kind?: string) => {
    const r = await prisma.prediction.findFirst({ where: { projectId: p.id, ...(kind ? { kind } : {}) }, orderBy: { createdAt: 'desc' }, include: { check: true } });
    return r ? toPredictionView(r) : null;
  };
  const [latest, final, recorded] = await Promise.all([latestOf(), latestOf('final'), latestOf('recorded')]);
  const running = !!(await prisma.job.findFirst({ where: { projectId: p.id, kind: { startsWith: 'predict_' }, status: { in: ['queued', 'running'] } } }));
  const published = (await prisma.publishedWork.count({ where: { projectId: p.id } })) > 0;
  const hasTranscript = !!(await prisma.projectFile.findFirst({ where: { projectId: p.id, kind: 'transcript' } }));
  const data: PredictionsData = {
    latest,
    final,
    recorded,
    running,
    published,
    canLockFinal: !published && p.stage !== 'draft' && !final,
    canLockRecorded: !published && hasTranscript && !recorded,
  };
  return ok(data);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { kind?: string };
  const kind = KINDS.find((k) => k === body.kind);
  if (!kind) return fail('kind 只能是 draft / final / recorded', 400);
  if ((await prisma.publishedWork.count({ where: { projectId: params.id } })) > 0) return fail(PUBLISHED_REFUSAL, 400);
  const started = await launchJob(prisma, params.id, `predict_${kind}` as JobKind);
  if (!started) return fail('正在预测', 409);
  return ok({ jobId: started.jobId });
}
