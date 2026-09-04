import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { videoProductionQueue } from '@/jobs/queue';
import { canStartProduction } from '@/lib/cockpit/production-status';

/**
 * 手动开始/重来一次生成(二十二期)。
 *
 * 动因: 真实使用里任务会**静静地躺着不动** —— worker 没启动时, 入队的任务从昨晚
 * 21:58 一直停在「排队中」, 成片页上一个可点的东西都没有, 也没有任何一句话解释
 * 为什么不动。光加个按钮解决不了这个: worker 不在的时候点了照样没反应, 只会变成
 * 新的困惑。所以这个路由除了入队, 还负责回答「为什么不动」。
 */

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('生成任务不存在', 404);

  if (!canStartProduction(vp.status)) {
    return fail(`这条任务当前是「${vp.status}」, 已经在处理或已完成, 不需要再启动`, 400);
  }
  // 真人出镜没有源视频时入队也只会立刻失败, 不如在这里说清楚
  if (vp.mode === 'talking-head-broll' && !vp.sourceVideoPath) {
    return fail('真人出镜模式要先在「录制」步骤上传出镜视频, 才能开始制作', 400);
  }

  // 固定 jobId 让重复点击幂等。BullMQ 遇到已存在的 jobId 会**静默丢弃**新任务,
  // 所以先把同 id 的旧 job 删掉再加 —— 否则"重来一次"会变成什么都没发生。
  // 分隔符只能用 '-': BullMQ 的 Job.validateOptions 拒绝含 ':' 的自定义 id
  // (真机踩过, 整个路由 500)。
  const jobId = `${params.id}-preview`;
  const stale = await videoProductionQueue.getJob(jobId);
  if (stale) await stale.remove();

  // 真人出镜的源视频已经落地过就保持 'source_uploaded' —— 对这个模式来说 'queued'
  // 是「视频还没传」的哨兵值(见 VideoProductionPanel 的 needsUploadFirst), 退回去
  // 会让面板反过来说"请先上传出镜视频"。
  const nextStatus = vp.mode === 'talking-head-broll' && vp.sourceVideoPath
    ? 'source_uploaded'
    : 'queued';

  const updated = await prisma.videoProduction.update({
    where: { id: params.id },
    data: { status: nextStatus, errorMessage: null, updatedAt: new Date().toISOString() },
  });

  await videoProductionQueue.add(
    'produce',
    { videoProductionId: params.id, mode: 'preview' },
    { jobId },
  );

  // 队列里有没有活着的 worker。查不到不影响入队 —— 这只是给用户的解释, 不是前置条件。
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
