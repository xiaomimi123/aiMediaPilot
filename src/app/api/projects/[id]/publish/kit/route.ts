import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import { makePublishKit } from '@/lib/retro/state';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const m = await getActiveModel(prisma);
  if (!m) return fail(NO_MODEL_MESSAGE, 400);
  try {
    return ok(await makePublishKit(prisma, params.id, m.llm));
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === '找不到这个项目') return fail(msg, 404);
    if (msg.startsWith('还没有稿子')) return fail(msg, 400);
    return fail(`发布文案没写出来（${m.label} 没按格式回答），再点一次。`, 502);
  }
}
