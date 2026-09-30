import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import { createPrismaStore } from '@/lib/benchmark/store';
import { suggestTopics, loadMyTopTitles } from '@/lib/benchmark/suggest';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';

export const dynamic = 'force-dynamic';

export async function POST() {
  const m = await getActiveModel(prisma);
  if (!m) return fail(NO_MODEL_MESSAGE, 400);
  const persona = await prisma.personaProfile.findUnique({ where: { id: 'me' } });
  try {
    const r = await suggestTopics({
      store: createPrismaStore(prisma),
      llm: m.llm,
      personaText: formatPersona(persona as PersonaLike | null),
      myTopTitles: await loadMyTopTitles(prisma),
      now: new Date(),
    });
    return r.ok ? ok(r.topics) : fail(r.reason, 400);
  } catch {
    return fail(`编导这次没挑出来（${m.label} 没按格式回答），再点一次。`, 502);
  }
}
