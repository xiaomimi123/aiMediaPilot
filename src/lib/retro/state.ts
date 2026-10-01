import type { Prisma, PrismaClient } from '@prisma/client';
import type { StructuredLLM } from '@/lib/script/write';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { findCandidate } from './match';
import { generatePublishKit, PublishKitSchema, type PublishKit } from './publish-kit';
import { toLessonView } from './view';

/** 项目的发布与复盘状态(网页「发布 / 复盘」两步与 mp retro show 共用); 项目不存在返回 null */
export async function loadPublishState(db: PrismaClient, projectId: string) {
  const p = await db.project.findUnique({ where: { id: projectId }, include: { retro: true } });
  if (!p) return null;
  const w = await db.publishedWork.findFirst({ where: { projectId: p.id }, orderBy: { publishedAt: 'desc' } });
  const kit = PublishKitSchema.safeParse(p.publishKit);
  const lessons = p.retro ? await db.writingLesson.findMany({ where: { retroId: p.retro.id, status: { not: 'rejected' } }, orderBy: { createdAt: 'asc' } }) : [];
  return {
    kit: kit.success ? kit.data : null,
    work: w ? { id: w.id, text: (w.title || w.caption).slice(0, 80), publishedAt: w.publishedAt.toISOString(), viewCount: w.viewCount ?? w.play, likeCount: w.likeCount ?? w.digg } : null,
    candidate: w ? null : await findCandidate(db, p.id),
    retro: p.retro
      ? { dayN: p.retro.dayN, diagnosis: p.retro.diagnosis, narrative: p.retro.narrative, narrativeError: p.retro.narrativeError, dataAsOf: p.retro.dataAsOf?.toISOString() ?? null, updatedAt: p.retro.updatedAt.toISOString() }
      : null,
    lessons: lessons.map(toLessonView),
  };
}

export type PublishState = NonNullable<Awaited<ReturnType<typeof loadPublishState>>>;

/** 生成发布文案并存到项目 */
export async function makePublishKit(db: PrismaClient, projectId: string, llm: StructuredLLM): Promise<PublishKit> {
  const p = await db.project.findUnique({ where: { id: projectId }, include: { benchmarkVideo: true } });
  if (!p) throw new Error('找不到这个项目');
  const s = ScriptSchema.safeParse(p.script);
  if (!s.success) throw new Error('还没有稿子，先写稿再生成发布文案。');
  const a = p.benchmarkVideo ? AnalysisSchema.safeParse(p.benchmarkVideo.analysis) : null;
  const kit = await generatePublishKit(llm, {
    scriptText: s.data.segments.map((x) => `${ROLE_LABEL[x.role]}：${x.text}`).join('\n'),
    personaText: formatPersona((p.personaSnapshot as PersonaLike | null) ?? null),
    benchmarkTitlePattern: a?.success ? a.data.titlePattern : undefined,
  });
  await db.project.update({ where: { id: p.id }, data: { publishKit: kit as unknown as Prisma.InputJsonValue } });
  return kit;
}
