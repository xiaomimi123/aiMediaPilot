import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { findCandidate } from '@/lib/retro/match';
import { PublishKitSchema } from '@/lib/retro/publish-kit';
import { toLessonView } from '@/lib/retro/view';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await prisma.project.findUnique({ where: { id: params.id }, include: { retro: true } });
  if (!p) return fail('找不到这个项目', 404);
  const w = await prisma.publishedWork.findFirst({ where: { projectId: p.id }, orderBy: { publishedAt: 'desc' } });
  const kit = PublishKitSchema.safeParse(p.publishKit);
  const lessons = p.retro ? await prisma.writingLesson.findMany({ where: { retroId: p.retro.id, status: { not: 'rejected' } }, orderBy: { createdAt: 'asc' } }) : [];
  return ok({
    kit: kit.success ? kit.data : null,
    work: w ? { id: w.id, text: (w.title || w.caption).slice(0, 80), publishedAt: w.publishedAt.toISOString(), viewCount: w.viewCount ?? w.play, likeCount: w.likeCount ?? w.digg } : null,
    candidate: w ? null : await findCandidate(prisma, p.id),
    retro: p.retro
      ? { dayN: p.retro.dayN, diagnosis: p.retro.diagnosis, narrative: p.retro.narrative, narrativeError: p.retro.narrativeError, dataAsOf: p.retro.dataAsOf?.toISOString() ?? null, updatedAt: p.retro.updatedAt.toISOString() }
      : null,
    lessons: lessons.map(toLessonView),
  });
}
