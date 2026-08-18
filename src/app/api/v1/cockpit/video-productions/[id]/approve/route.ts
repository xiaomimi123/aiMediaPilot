import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { videoProductionQueue } from '@/jobs/queue';

/**
 * 确认导出 (十八期 T8) — preview 阶段人工确认后触发正式 master 渲染。
 * 只允许从 preview_ready 转 approved, 其它状态一律 400 (防止重复入队 /
 * 在渲染未完成时误触发)。
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);
  if (vp.status !== 'preview_ready') return fail('当前状态不可确认导出', 400);

  const updated = await prisma.videoProduction.update({
    where: { id: params.id },
    data: { status: 'approved', updatedAt: new Date().toISOString() },
  });
  await videoProductionQueue.add('produce', { videoProductionId: params.id, mode: 'master' });
  return ok({ id: updated.id, status: updated.status });
}
