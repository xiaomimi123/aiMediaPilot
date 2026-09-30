import type { PrismaClient } from '@prisma/client';
import { toLessonView } from './view';

export const MAX_ACTIVE_LESSONS = 10;

export interface LessonForPrompt {
  text: string;
  evidenceCount: number;
}

export function formatLessons(ls: LessonForPrompt[]): string {
  return ls.map((l) => `- ${l.text}（${l.evidenceCount <= 1 ? `证据少：${l.evidenceCount} 条作品` : `${l.evidenceCount} 条作品`}）`).join('\n');
}

export async function loadActiveLessons(db: PrismaClient): Promise<LessonForPrompt[]> {
  const rows = await db.writingLesson.findMany({ where: { status: 'active' }, orderBy: { confirmedAt: 'desc' }, take: MAX_ACTIVE_LESSONS });
  return rows.map((r) => ({ text: r.text, evidenceCount: Array.isArray(r.evidence) ? r.evidence.length : 0 }));
}

/** 采纳 / 停用 / 不要 / 改文字(网页与 mp lessons 共用); 不合法抛 Error(中文) */
export async function updateLesson(db: PrismaClient, id: string, body: { status?: string; text?: string }) {
  const l = await db.writingLesson.findUnique({ where: { id } });
  if (!l) throw new Error('找不到这条经验');
  if (body.status && !['active', 'retired', 'rejected'].includes(body.status)) throw new Error('状态不对');
  const text = typeof body.text === 'string' ? body.text.trim() : undefined;
  if (text !== undefined && (text.length < 4 || text.length > 80)) throw new Error('经验写成一句话（4～80 字）');
  const row = await db.writingLesson.update({
    where: { id: l.id },
    data: {
      ...(text !== undefined ? { text } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.status === 'active' ? { confirmedAt: new Date(), contradicted: false } : {}),
    },
  });
  return toLessonView(row);
}
