import type { PrismaClient } from '@prisma/client';

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
