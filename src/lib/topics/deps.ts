import type { Prisma, PrismaClient } from '@prisma/client';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import { writeScript } from '@/lib/script/write';
import { ScriptSchema } from '@/lib/script/model';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { HIT_RATIO } from '@/lib/benchmark/rules';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import { formatLessons, loadActiveLessons } from '@/lib/retro/lessons';
import { loadCurrentTranscript } from '@/lib/recording/transcript';
import { recentSampleTexts } from '@/lib/voice/samples';
import { loadPredictContext, predictScript, scriptSegments } from '@/lib/predict/run';
import type { CandidateStore } from './candidates';
import { RECENT_HOURS, succeededRecently, TARGET_SEC, type GenDeps } from './generate';

export function createCandidateStore(db: PrismaClient): CandidateStore {
  return {
    async usedKeys() {
      const rows = await db.dailyTopic.findMany({ select: { source: true, sourceId: true } });
      return new Set(rows.map((r) => `${r.source}:${r.sourceId}`));
    },
    async benchmarkHits(since) {
      const rows = await db.benchmarkVideo.findMany({ where: { status: { notIn: ['ignored', 'adopted'] }, publishedAt: { gte: since }, OR: [{ isHit: true }, { ratio: { gte: HIT_RATIO } }] }, include: { account: true } });
      return rows.map((v) => {
        const a = AnalysisSchema.safeParse(v.analysis);
        return { id: v.id, ratio: v.ratio, author: v.account.nickname, topic: a.success ? a.data.topic : null, desc: v.desc, transcript: v.transcript };
      });
    },
    async ownWorks() {
      const works = await db.publishedWork.findMany({ where: { isPrivate: false, projectId: { not: null } }, orderBy: { publishedAt: 'desc' }, take: 10 });
      const out = [];
      for (const w of works) {
        const p = await db.project.findUnique({ where: { id: w.projectId! } });
        if (!p) continue;
        const t = await loadCurrentTranscript(db, p.id);
        const s = ScriptSchema.safeParse(p.script);
        const lastText = t?.data.lines.slice(-3).map((l) => l.text).join(' ') || (s.success ? s.data.segments.at(-1)?.text ?? null : null);
        out.push({ projectId: p.id, title: p.title, lastText, play: w.play });
      }
      return out;
    },
    freshIdeas: () => db.topicIdea.findMany({ where: { status: 'fresh' } }),
  };
}

export async function createGenDeps(db: PrismaClient, now: Date): Promise<GenDeps> {
  const model = await getActiveModel(db);
  const persona = await db.personaProfile.findUnique({ where: { id: 'me' } });
  const lessons = await loadActiveLessons(db);
  return {
    llm: model?.llm ?? null,
    noModelReason: NO_MODEL_MESSAGE,
    now,
    store: createCandidateStore(db),
    personaText: formatPersona(persona as PersonaLike | null),
    lessons: lessons.length ? formatLessons(lessons) : undefined,
    samples: await recentSampleTexts(db),
    write: writeScript,
    async predict(script, benchmarkVideoId) {
      if (!model) return null;
      try {
        return await predictScript(model.llm, model.label, await loadPredictContext(db, benchmarkVideoId ?? null), scriptSegments(script, TARGET_SEC));
      } catch {
        return null;
      }
    },
    async save(t) {
      try {
        await db.dailyTopic.create({ data: { ...t, script: t.script as unknown as Prisma.InputJsonValue, copied: t.copied as unknown as Prisma.InputJsonValue, checklist: t.checklist as unknown as Prisma.InputJsonValue, prediction: (t.prediction ?? undefined) as unknown as Prisma.InputJsonValue } });
        return 'saved';
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') return 'duplicate';
        throw e;
      }
    },
    markIdeaUsed: async (id) => void (await db.topicIdea.update({ where: { id }, data: { status: 'used' } })),
    recordRun: async (r) => void (await db.dailyTopicRun.create({ data: { day: r.day, created: r.created, skipped: r.skipped as unknown as Prisma.InputJsonValue } })),
    async doneRecently(now) {
      const rows = await db.dailyTopicRun.findMany({ where: { created: { gte: 1 }, createdAt: { gte: new Date(now.getTime() - RECENT_HOURS * 3600_000) } }, select: { createdAt: true } });
      return succeededRecently(rows.map((r) => r.createdAt), now);
    },
  };
}
