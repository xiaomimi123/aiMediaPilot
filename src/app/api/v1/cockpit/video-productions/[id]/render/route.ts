import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { videoProductionQueue } from '@/jobs/queue';

/**
 * 确认分镜方案、继续渲染(三十一期 Task 1)——生成前剪辑台的「确认」按钮打这个路由。
 *
 * 背景: `reviewBeforeRender` 开着时, worker 产完 FilmPlan 会主动停在 `plan_ready`
 * 状态等用户逐镜调整方案(TTS/ASR/对齐都已经跑完并落盘, 停的只是渲染这一步)。
 * 这个路由就是"我看过了, 继续渲"——只接受 `status === 'plan_ready'` 的任务,
 * 不是随便一个任务都能点确认。
 *
 * 与 `/start` 的关键差异——job payload 多一个 `skipPlanGeneration: true` 标记:
 * worker(`video-production-worker.ts`)读到这个字段就跳过 TTS/ASR/对齐/
 * buildFilmPlan/落库整段, 直接从库里读已经落盘的 filmPlan/alignedActs 进入渲染段
 * (与 master 分支复用同一条"跳过 AI、复用落库产物"的路径, 见该文件顶部注释)。
 * `/start` 不带这个字段——那是"重新生成"的语义, 会覆盖用户在剪辑台里对方案做的
 * 调整, 必须让用户显式点"重新生成"才能触发(确认对话框文案是 Task 4 的事,
 * 这里只保证 worker 语义正确)。
 *
 * jobId/幂等/worker 在线检查照抄 `/start` 路由的先例, 理由同款——见该文件注释。
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('生成任务不存在', 404);

  if (vp.status !== 'plan_ready') {
    return fail(`这条任务当前是「${vp.status}」, 不是「分镜待确认」, 不能确认渲染`, 400);
  }

  // 固定 jobId 让重复点击幂等, 与 /start 用同一条规则(同一个 videoProductionId
  // 的 preview 渲染始终只应该有一个在跑的 job)——分隔符只能用 '-', 理由见 /start。
  const jobId = `${params.id}-preview`;
  const stale = await videoProductionQueue.getJob(jobId);
  if (stale) await stale.remove();

  const updated = await prisma.videoProduction.update({
    where: { id: params.id },
    data: { status: 'queued', errorMessage: null, updatedAt: new Date().toISOString() },
  });

  await videoProductionQueue.add(
    'produce',
    { videoProductionId: params.id, mode: 'preview', skipPlanGeneration: true },
    { jobId },
  );

  // 队列里有没有活着的 worker——只是给用户的解释, 不是入队的前置条件, 同 /start。
  let workerOnline: boolean | null = null;
  try {
    workerOnline = (await videoProductionQueue.getWorkers()).length > 0;
  } catch {
    workerOnline = null;
  }

  return ok({
    id: updated.id,
    status: updated.status,
    workerOnline,
    hint:
      workerOnline === false
        ? '任务已排队，但后台处理进程没在运行。在项目目录执行 npm run worker:dev 后会自动开始。'
        : null,
  });
}
