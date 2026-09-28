import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getDeepSeekKey } from '@/lib/env';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { createPrismaStore } from '@/lib/benchmark/store';
import { suggestTopics, loadMyTopTitles } from '@/lib/benchmark/suggest';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';

export const dynamic = 'force-dynamic';

export async function POST() {
  const key = getDeepSeekKey();
  if (!key) return fail('没有配置 DeepSeek key：去设置页填入后再试。', 400);
  const persona = await prisma.personaProfile.findUnique({ where: { id: 'me' } });
  try {
    const r = await suggestTopics({
      store: createPrismaStore(prisma),
      llm: new DeepSeekTextLLM({ apiKey: key }),
      personaText: formatPersona(persona as PersonaLike | null),
      myTopTitles: await loadMyTopTitles(prisma),
      now: new Date(),
    });
    return r.ok ? ok(r.topics) : fail(r.reason, 400);
  } catch {
    return fail('编导这次没挑出来（DeepSeek 没按格式回答），再点一次。', 502);
  }
}
