import type { PrismaClient } from '@prisma/client';
import type { PredictionResult } from './formula';

export const LAG_TOOL = 'predict:lag';

/** 发布满 1 天不满 2 天: < 中枢 30%; 满 2 天不满 3 天: < 50% */
export function isBehind(days: number, views: number, center: number): boolean {
  if (days >= 1 && days < 2) return views < center * 0.3;
  if (days >= 2 && days < 3) return views < center * 0.5;
  return false;
}

export async function findLagging(db: PrismaClient, now: Date) {
  const since = new Date(now.getTime() - 3 * 86400_000);
  const works = await db.publishedWork.findMany({ where: { projectId: { not: null }, isPrivate: false, publishedAt: { gte: since } }, include: { project: true } });
  const out: { workId: string; projectId: string; title: string; days: number; views: number; center: number }[] = [];
  for (const w of works) {
    const p = (await db.prediction.findFirst({ where: { projectId: w.projectId!, kind: 'recorded' }, orderBy: { createdAt: 'desc' } })) ?? (await db.prediction.findFirst({ where: { projectId: w.projectId!, kind: 'final' }, orderBy: { createdAt: 'desc' } }));
    const center = (p?.result as unknown as PredictionResult | undefined)?.center ?? null;
    const days = (now.getTime() - w.publishedAt.getTime()) / 86400_000;
    if (center !== null && w.viewCount !== null && isBehind(days, w.viewCount, center)) out.push({ workId: w.id, projectId: w.projectId!, title: w.project!.title, days, views: w.viewCount, center });
  }
  return out;
}

export async function postLagAlerts(db: PrismaClient, now: Date): Promise<number> {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let n = 0;
  for (const l of await findLagging(db, now)) {
    // 按作品去重: 同一项目关联了两条作品时各提醒一次
    const toolName = `${LAG_TOOL}:${l.workId}`;
    if (await db.chatMessage.findFirst({ where: { projectId: l.projectId, toolName, createdAt: { gte: today } } })) continue;
    await db.chatMessage.create({
      data: { projectId: l.projectId, role: 'system', toolName, toolResult: { ok: false }, content: `比预期落后：发布第 ${Math.floor(l.days)} 天播放 ${l.views.toLocaleString('en-US')}，预测中枢约 ${l.center.toLocaleString('en-US')}。` },
    });
    n++;
  }
  return n;
}
