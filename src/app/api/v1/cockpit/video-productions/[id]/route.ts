import fs from 'fs/promises';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

/**
 * 单条成片生成状态轮询 (十八期 T8) — 归属校验用 404 而非 403,
 * 与本项目既有约定一致 (不裸露资源存在性)。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);

  return ok({
    id: vp.id,
    status: vp.status,
    previewPath: vp.previewPath,
    masterPath: vp.masterPath,
    errorMessage: vp.errorMessage,
  });
}

/** 进行中的状态 —— worker 还在往 productionRoot 写盘, 此时删目录会让它中途崩在莫名其妙的地方。 */
const IN_FLIGHT = new Set([
  'queued', 'source_uploaded', 'directing', 'building', 'assembling', 'approved', 'rendering', 'packaging',
]);

/**
 * 删除一次生成任务(二十一期) —— 真实使用提出: 成片库里堆着不满意的版本和失败的任务,
 * 没有任何清理手段。连同 productionRoot 下的分镜/中间产物/成片一并清掉, 否则磁盘只增不减。
 *
 * 进行中的任务拒绝删除而不是强删: 这是"删除"不是"取消", BullMQ 里的 job 不会因为记录没了
 * 就停下, 强删只会让它在写盘时崩在难以定位的地方。
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);

  if (IN_FLIGHT.has(vp.status)) {
    return fail('任务进行中，等它跑完或失败后再删', 400);
  }

  await prisma.videoProduction.delete({ where: { id: params.id } });
  // 目录清理失败不阻断 —— 记录已经没了, 留个孤儿目录不影响正确性(同模板删除的既有语义)。
  await fs.rm(vp.productionRoot, { recursive: true, force: true }).catch(() => {});
  return ok({ deleted: true });
}
