import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getDeepSeekKey } from '@/lib/env';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { makePublishKit } from '@/lib/retro/state';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const key = getDeepSeekKey();
  if (!key) return fail('没有配置 DeepSeek key：去设置页填入后再试。', 400);
  try {
    return ok(await makePublishKit(prisma, params.id, new DeepSeekTextLLM({ apiKey: key })));
  } catch (e) {
    const m = e instanceof Error ? e.message : '';
    if (m === '找不到这个项目') return fail(m, 404);
    if (m.startsWith('还没有稿子')) return fail(m, 400);
    return fail('发布文案没写出来（DeepSeek 没按格式回答），再点一次。', 502);
  }
}
