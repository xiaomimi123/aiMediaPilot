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
