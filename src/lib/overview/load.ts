import type { PrismaClient } from '@prisma/client';
import { toProjectView } from '@/lib/project/view';
import { latestForDisplay } from '@/lib/cli/commands/predict';
import { stepsOf, type WorkCardData } from './steps';

export async function loadWorkCards(db: PrismaClient): Promise<WorkCardData[]> {
  const rows = await db.project.findMany({ orderBy: { updatedAt: 'desc' }, include: { retro: { select: { id: true } }, publishedWorks: { orderBy: { publishedAt: 'desc' }, take: 1 } } });
  const out: WorkCardData[] = [];
  for (const p of rows) {
    const v = toProjectView(p);
    const w = p.publishedWorks[0] ?? null;
    const pred = w ? null : await latestForDisplay(db, p.id);
    out.push({
      id: p.id,
      title: p.title,
      stage: p.stage,
      steps: stepsOf({ stage: p.stage, hasBenchmark: !!p.benchmarkVideoId, hasScript: !!v.script, published: !!w, hasRetro: !!p.retro }),
      durationSec: v.report ? v.report.totalSec : null,
      center: pred?.result.center ?? null,
      views: w ? w.viewCount ?? w.play : null,
      updatedAt: v.updatedAt,
    });
  }
  return out;
}
