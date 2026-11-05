import type { PrismaClient } from '@prisma/client';

type Db = Pick<PrismaClient, 'draft' | 'topicIdea'>;

/** 草稿正文上限: 口播稿几百字足够, 防止误贴超长文本 */
export const MAX_BODY_CHARS = 20000;

export interface DraftView {
  id: string;
  title: string;
  body: string;
  source: string;
  ideaId: string | null;
  status: string;
  updatedAt: string;
}

export const toDraftView = (d: { id: string; title: string; body: string; source: string; ideaId: string | null; status: string; updatedAt: Date }): DraftView => ({
  id: d.id,
  title: d.title,
  body: d.body,
  source: d.source,
  ideaId: d.ideaId,
  status: d.status,
  updatedAt: d.updatedAt.toISOString(),
});

export async function listDrafts(db: Db): Promise<DraftView[]> {
  const rows = await db.draft.findMany({ orderBy: { updatedAt: 'desc' }, take: 100 });
  return rows.map(toDraftView);
}

export async function getDraft(db: Db, id: string): Promise<DraftView | null> {
  const d = await db.draft.findUnique({ where: { id } });
  return d ? toDraftView(d) : null;
}

export async function createDraft(db: Db, o: { title?: string; body?: string; source?: string; ideaId?: string | null }): Promise<DraftView> {
  const d = await db.draft.create({
    data: {
      title: (o.title ?? '').trim().slice(0, 100),
      body: (o.body ?? '').slice(0, MAX_BODY_CHARS),
      source: o.source === 'idea' ? 'idea' : 'blank',
      ideaId: o.ideaId ?? null,
    },
  });
  return toDraftView(d);
}

/** 自动保存用的更新; 空标题不覆盖已有标题 */
export async function updateDraft(db: Db, id: string, o: { title?: string; body?: string; status?: string }): Promise<DraftView | null> {
  const cur = await db.draft.findUnique({ where: { id } });
  if (!cur) return null;
  const data: { title?: string; body?: string; status?: string } = {};
  const title = o.title?.trim();
  if (title) data.title = title.slice(0, 100);
  if (o.body !== undefined) data.body = o.body.slice(0, MAX_BODY_CHARS);
  if (o.status !== undefined) data.status = o.status;
  if (!Object.keys(data).length) return toDraftView(cur);
  const d = await db.draft.update({ where: { id }, data });
  return toDraftView(d);
}

export const deleteDraft = (db: Db, id: string) => db.draft.delete({ where: { id } });

/** 从点子池的一句灵感开一篇草稿; 顺带把点子标成已用 */
export async function draftFromIdea(db: Db, ideaId: string): Promise<DraftView> {
  const idea = await db.topicIdea.findUnique({ where: { id: ideaId } });
  if (!idea || idea.status === 'deleted') throw new Error('点子不存在');
  const d = await db.draft.create({
    data: {
      title: idea.text.slice(0, 40),
      body: idea.text,
      source: 'idea',
      ideaId: idea.id,
    },
  });
  if (idea.status === 'fresh') await db.topicIdea.update({ where: { id: idea.id }, data: { status: 'used' } });
  return toDraftView(d);
}
