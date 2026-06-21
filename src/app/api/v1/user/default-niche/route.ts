import { ok } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

/**
 * 返回用户的默认 niche.
 * 优先级: 用户最近 100 条 ScriptDraft 里出现最频繁的 niche → 'ai-knowledge' 兜底.
 */
export async function GET() {
  const user = await getOrCreateDefaultUser();
  const recent = await prisma.scriptDraft.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { niche: true },
  });

  if (recent.length === 0) {
    return ok({ niche: 'ai-knowledge', source: 'fallback' });
  }

  const counts = new Map<string, number>();
  for (const s of recent) {
    counts.set(s.niche, (counts.get(s.niche) ?? 0) + 1);
  }
  let topNiche = 'ai-knowledge';
  let topCount = 0;
  for (const [n, c] of counts.entries()) {
    if (c > topCount) {
      topNiche = n;
      topCount = c;
    }
  }
  return ok({ niche: topNiche, source: 'most-frequent', total: recent.length, matched: topCount });
}
