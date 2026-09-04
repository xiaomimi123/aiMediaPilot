import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { videoProductionQueue } from '@/jobs/queue';

/**
 * 按当前版面重新合成(二十三期)。
 *
 * **不是重跑预览。** 重跑预览会让导演重新切镜, shotId 全变 —— 刚存的逐场景版面
 * 立刻变成孤儿, 而且白烧几分钟的 LLM 和逐帧截图。改版面只影响合成那一步,
 * 分镜和已渲好的 B-roll 片段原样复用。
 *
 * 只在 `preview_ready` 时允许: 再往前没有分镜可复用, 再往后已经在正式渲染了。
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);
  if (vp.status !== 'preview_ready') {
    return fail(`只有预览就绪时能重新合成(当前: ${vp.status})`, 400);
  }

  await prisma.videoProduction.update({
    where: { id: params.id },
    data: { status: 'assembling', updatedAt: new Date().toISOString() },
  });
  await videoProductionQueue.add('produce', { videoProductionId: params.id, mode: 'recompose' });
  return ok({ id: params.id, status: 'assembling' });
}
