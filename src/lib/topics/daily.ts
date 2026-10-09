import type { Prisma, PrismaClient } from '@prisma/client';
import type { Script } from '@/lib/script/model';
import type { ScriptPrediction } from '@/lib/predict/run';
import { localDay, type TopicSource } from './candidates';
import { TARGET_SEC } from './generate';

export const EXPIRE_DAYS = 3;
const LABEL: Record<TopicSource, string> = { benchmark: '对标', sequel: '续集', idea: '点子' };

export interface DailyCard { id: string; day: string; source: TopicSource; sourceLabel: string; title: string; why: string; hook: string; script: Script; copied: number; predictedCenter: number | null; status: string }

export async function listDaily(db: PrismaClient, now: Date) {
  const cutoff = localDay(new Date(now.getTime() - EXPIRE_DAYS * 86400_000));
  await db.dailyTopic.updateMany({ where: { status: 'new', day: { lte: cutoff } }, data: { status: 'expired' } });
  const rows = await db.dailyTopic.findMany({ where: { status: 'new' } });
  const topics: DailyCard[] = rows
    .map((t) => {
      const p = t.prediction as unknown as ScriptPrediction | null;
      return { id: t.id, day: t.day, source: t.source as TopicSource, sourceLabel: LABEL[t.source as TopicSource], title: t.title, why: t.why, hook: t.hook, script: t.script as unknown as Script, copied: (t.copied as unknown[]).length, predictedCenter: p?.result?.center ?? null, status: t.status };
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
