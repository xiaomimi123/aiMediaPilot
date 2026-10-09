import type { Prisma, PrismaClient } from '@prisma/client';
import type { Script } from '@/lib/script/model';
import type { ScriptPrediction } from '@/lib/predict/run';
import { localDay, type TopicSource } from './candidates';
import { checklistQuestion, ChecklistSchema, rewriteWithAnswers, TARGET_SEC, type GenDeps } from './generate';

export const EXPIRE_DAYS = 3;
const LABEL: Record<TopicSource, string> = { benchmark: '对标', sequel: '续集', idea: '点子' };

export interface DailyCard { id: string; day: string; source: TopicSource; sourceLabel: string; title: string; why: string; hook: string; script: Script; copied: number; predictedCenter: number | null; status: string; questions: string[]; answers: string[]; answered: boolean }

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : '')) : []);

/** 问题与回答(逐项对应); 旧数据只有实测清单和结果时转成问题和回答 */
export function topicQuestions(t: { questions?: unknown; answers?: unknown; checklist?: unknown; results?: unknown }): { questions: string[]; answers: string[] } {
  let questions = strings(t.questions).filter((q) => q.trim());
  let raw = t.answers;
  if (!questions.length) {
    const list = ChecklistSchema.safeParse(t.checklist);
    if (!list.success) return { questions: [], answers: [] };
    questions = list.data.map(checklistQuestion);
    raw = t.results;
  }
  const got = strings(raw);
  return { questions, answers: questions.map((_, i) => got[i] ?? '') };
}

export async function listDaily(db: PrismaClient, now: Date) {
  const cutoff = localDay(new Date(now.getTime() - EXPIRE_DAYS * 86400_000));
  await db.dailyTopic.updateMany({ where: { status: 'new', day: { lte: cutoff } }, data: { status: 'expired' } });
  const rows = await db.dailyTopic.findMany({ where: { status: 'new' } });
  const qa = (t: (typeof rows)[number]) => {
    const { questions, answers } = topicQuestions(t);
    return { questions, answers, answered: answers.some((a) => a.trim()) };
  };
  const topics: DailyCard[] = rows
    .map((t) => {
      const p = t.prediction as unknown as ScriptPrediction | null;
      return { id: t.id, day: t.day, source: t.source as TopicSource, sourceLabel: LABEL[t.source as TopicSource], title: t.title, why: t.why, hook: t.hook, script: t.script as unknown as Script, copied: (t.copied as unknown[]).length, predictedCenter: p?.result?.center ?? null, status: t.status, ...qa(t) };
    })
    .sort((a, b) => (b.predictedCenter ?? -1) - (a.predictedCenter ?? -1));
  const run = await db.dailyTopicRun.findFirst({ orderBy: { createdAt: 'desc' } });
  const lastRun = run ? { day: run.day, created: run.created, reasons: (run.skipped as { reason: string }[]).map((s) => s.reason) } : null;
  return { topics, lastRun };
}

export async function adoptDaily(db: PrismaClient, id: string): Promise<{ projectId: string }> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.dailyTopic.updateMany({ where: { id, status: 'new' }, data: { status: 'adopted' } });
    if (!claimed.count) throw new Error('这个选题已经处理过了');
    const t = await tx.dailyTopic.findUniqueOrThrow({ where: { id } });
    const persona = await tx.personaProfile.findUnique({ where: { id: 'me' } });
    // 对标作品可能已被删(删对标账号会连带删作品): 那就不关联它
    const bv = t.source === 'benchmark' ? await tx.benchmarkVideo.findUnique({ where: { id: t.sourceId } }) : null;
    const p = await tx.project.create({
      data: {
        title: t.title,
        script: t.script as Prisma.InputJsonValue,
        targetSec: TARGET_SEC,
        personaSnapshot: persona ? (JSON.parse(JSON.stringify(persona)) as Prisma.InputJsonValue) : undefined,
        ...(bv ? { benchmarkVideoId: bv.id } : {}),
      },
    });
    const pred = t.prediction as unknown as ScriptPrediction | null;
    if (pred) await tx.prediction.create({ data: { projectId: p.id, kind: 'draft', formulaVersion: pred.formulaVersion, inputHash: pred.inputHash, scores: pred.scores as unknown as Prisma.InputJsonValue, result: pred.result as unknown as Prisma.InputJsonValue } });
    if (bv) await tx.benchmarkVideo.update({ where: { id: bv.id }, data: { status: 'adopted' } });
    await tx.dailyTopic.update({ where: { id }, data: { projectId: p.id } });
    // 问过的材料带进作品的编导对话: 答过的作为事实, 没答的留给博主在对话里补
    const { questions, answers } = topicQuestions(t);
    if (questions.length) {
      const done = questions.map((q, i) => ({ q, a: answers[i].trim() })).filter((x) => x.a);
      const open = questions.filter((_, i) => !answers[i].trim());
      const parts = ['这条选题问过你一些材料。没答的问题，想好了直接在对话里告诉编导，让它按你的话改稿。'];
      if (done.length) parts.push(`你答过的材料：\n${done.map((x) => `问：${x.q}\n答：${x.a}`).join('\n')}`);
      if (open.length) parts.push(`还没答的问题：\n${open.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
      await tx.chatMessage.create({ data: { projectId: p.id, role: 'system', content: parts.join('\n\n'), toolName: 'job:topic', toolResult: { ok: true } } });
    }
    return { projectId: p.id };
  });
}

export async function dismissDaily(db: PrismaClient, id: string) {
  const r = await db.dailyTopic.updateMany({ where: { id, status: 'new' }, data: { status: 'dismissed' } });
  if (!r.count) throw new Error('这个选题已经处理过了');
}

export const listIdeas = (db: PrismaClient) => db.topicIdea.findMany({ where: { status: { not: 'deleted' } }, orderBy: { createdAt: 'desc' } });

export async function addIdea(db: PrismaClient, text: string) {
  const t = text.trim();
  if (!t) throw new Error('点子是空的');
  return db.topicIdea.create({ data: { text: t.slice(0, 500) } });
}

export const deleteIdea = (db: PrismaClient, id: string) => db.topicIdea.update({ where: { id }, data: { status: 'deleted' } });

/** 今天没有选题时显示的原因: 只在最近一次生成一个都没出时才说(否则是用户已经处理完了) */
export function dailyReason(lastRun: { day?: string; created: number; reasons: string[] } | null): string | null {
  return lastRun && lastRun.created === 0 ? (lastRun.reasons[0] ?? null) : null;
}

/** 按用户的回答重写初稿(只对还没处理的选题), 存下问题和回答 */
export async function answerDaily(
  db: PrismaClient,
  deps: Pick<GenDeps, 'llm' | 'noModelReason' | 'write' | 'predict' | 'personaText' | 'lessons' | 'samples'>,
  id: string,
  answers: string[],
): Promise<void> {
  const t = await db.dailyTopic.findUniqueOrThrow({ where: { id } });
  if (t.status !== 'new') throw new Error('这个选题已经处理过了');
  const { questions } = topicQuestions(t);
  if (!questions.length) throw new Error('这个选题没有要问你的问题');
  const filled = questions.map((_, i) => String(answers[i] ?? ''));
  const r = await rewriteWithAnswers(deps, { ...t, questions }, filled);
  await db.dailyTopic.update({
    where: { id },
    data: {
      questions: questions as unknown as Prisma.InputJsonValue,
      answers: filled as unknown as Prisma.InputJsonValue,
      script: r.script as unknown as Prisma.InputJsonValue,
      prediction: (r.prediction ?? undefined) as unknown as Prisma.InputJsonValue,
    },
  });
}
