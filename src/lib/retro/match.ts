import type { PrismaClient } from '@prisma/client';

export const MATCH_THRESHOLD = 0.35;
const WINDOW_DAYS = 14;

/** 字符二元组: 单字重合太容易(同是 AI 话题的帖子会共享"ai""工"等字), 连续两字才算真相关 */
function bigrams(s: string): Set<string> {
  const c = Array.from(s.replace(/[\s\p{P}\p{S}#]/gu, '').toLowerCase());
  const out = new Set<string>();
  for (let i = 0; i + 1 < c.length; i++) out.add(c[i] + c[i + 1]);
  return out;
}
/** 文字重合不到这个比例的一律不算候选, 不管发得多近 */
export const MIN_OVERLAP = 0.4;

/** 二元组重合度(占较短一方) 0.7 + 时间接近度 0.3; 早于成片登记或重合度不足为 0 */
export function scoreMatch(p: { filmAt: Date; kitText: string }, w: { publishedAt: Date; text: string }): number {
  const hours = (w.publishedAt.getTime() - p.filmAt.getTime()) / 3600_000;
  if (hours < 0 || hours > WINDOW_DAYS * 24) return 0;
  const a = bigrams(p.kitText);
  const b = bigrams(w.text);
  const inter = [...a].filter((c) => b.has(c)).length;
  const overlap = a.size && b.size ? inter / Math.min(a.size, b.size) : 0;
  if (overlap < MIN_OVERLAP) return 0;
  const recency = 1 - hours / (WINDOW_DAYS * 24);
  return Math.round((overlap * 0.7 + recency * 0.3) * 1000) / 1000;
}

export function pickCandidate(
  p: { filmAt: Date; kitText: string },
  works: { id: string; publishedAt: Date; text: string; isPrivate: boolean; projectId: string | null; matchDismissed: boolean }[],
): string | null {
  let best: { id: string; s: number } | null = null;
  for (const w of works) {
    if (w.isPrivate || w.projectId || w.matchDismissed) continue;
    const s = scoreMatch(p, w);
    if (s >= MATCH_THRESHOLD && (!best || s > best.s)) best = { id: w.id, s };
  }
  return best?.id ?? null;
}

type Kit = { titles?: string[]; hashtags?: string[] } | null;

export async function findCandidate(db: PrismaClient, projectId: string) {
  const p = await db.project.findUnique({ where: { id: projectId }, include: { files: { where: { kind: 'final_mp4' }, orderBy: { createdAt: 'asc' }, take: 1 } } });
  if (!p || p.stage !== 'final' || !p.files[0]) return null;
  if (await db.publishedWork.count({ where: { projectId } })) return null;
  const kit = p.publishKit as Kit;
  const kitText = [p.title, ...(kit?.titles ?? []), ...(kit?.hashtags ?? [])].join(' ');
  const filmAt = p.files[0].createdAt;
  const works = await db.publishedWork.findMany({ where: { publishedAt: { gte: filmAt }, isPrivate: false, projectId: null, matchDismissed: false } });
  const id = pickCandidate({ filmAt, kitText }, works.map((w) => ({ ...w, text: `${w.title} ${w.caption}` })));
  const w = works.find((x) => x.id === id);
  return w ? { workId: w.id, text: w.title || w.caption, publishedAt: w.publishedAt.toISOString() } : null;
}

export async function linkWork(db: PrismaClient, projectId: string, workId: string): Promise<void> {
  const w = await db.publishedWork.findUniqueOrThrow({ where: { id: workId } });
  if (w.projectId === projectId) return; // 重复点确认: 已经关联过了, 不再写通知
  if (w.projectId) throw new Error('这条作品已经关联到别的项目了');
  const other = await db.publishedWork.findFirst({ where: { projectId, id: { not: workId } } });
  if (other) throw new Error('这个项目已经关联了一条作品，一个项目只对应一条发布。');
  await db.publishedWork.update({ where: { id: workId }, data: { projectId } });
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  if (['draft', 'scripted', 'recorded', 'final'].includes(p.stage)) await db.project.update({ where: { id: projectId }, data: { stage: 'published' } });
  await db.chatMessage.create({
    data: { projectId, role: 'system', content: `已关联发布的作品：${(w.title || w.caption).slice(0, 40)}（${w.publishedAt.toLocaleDateString('zh-CN')}）。第 3 天会自动复盘。`, toolName: 'job:publish', toolResult: { ok: true } },
  });
}

export async function dismissWork(db: PrismaClient, workId: string): Promise<void> {
  await db.publishedWork.update({ where: { id: workId }, data: { matchDismissed: true } });
}
