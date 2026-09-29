import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { findCandidate } from '@/lib/retro/match';
import type { Diagnosis } from '@/lib/retro/diagnose';

export const dynamic = 'force-dynamic';

export async function GET() {
  const works = await prisma.publishedWork.findMany({ where: { projectId: { not: null } }, include: { project: { include: { retro: true } } }, orderBy: { publishedAt: 'desc' } });
  const published = works
    .filter((w) => w.project)
    .map((w) => {
      const d = w.project!.retro?.diagnosis as Diagnosis | undefined;
      const v = (k: string) => d?.stages.find((s) => s.key === k)?.verdict ?? 'na';
      return { projectId: w.project!.id, title: w.project!.title, publishedAt: w.publishedAt.toISOString(), retroDayN: w.project!.retro?.dayN ?? null, verdicts: { hook2s: v('hook2s'), hook5s: v('hook5s'), ending: v('ending'), like: v('like') } };
    });
  const finals = await prisma.project.findMany({ where: { stage: 'final' }, select: { id: true, title: true } });
  const pendingLinks = [];
  for (const p of finals) if (await findCandidate(prisma, p.id)) pendingLinks.push({ projectId: p.id, title: p.title });
  return ok({ published, pendingLinks });
}
