import type { PrismaClient } from '@prisma/client';

export type ThreadView = { id: string; title: string; updatedAt: string };
const view = (t: { id: string; title: string; updatedAt: Date }): ThreadView => ({ id: t.id, title: t.title, updatedAt: t.updatedAt.toISOString() });

/** 对话列表: 不显示没说过话的空对话(正打开的那个除外) */
export async function listThreads(db: PrismaClient, currentId?: string): Promise<ThreadView[]> {
  const rows = await db.assistantThread.findMany({ orderBy: { updatedAt: 'desc' }, take: 50, include: { _count: { select: { messages: true } } } });
  return rows.filter((t) => t._count.messages > 0 || t.id === currentId).map(view);
}

/** 新对话: 已经有空对话就复用它(挪到最前), 不再堆空对话 */
export async function newThread(db: PrismaClient): Promise<ThreadView> {
  const empty = await db.assistantThread.findFirst({ where: { messages: { none: {} } }, orderBy: { createdAt: 'desc' } });
  if (empty) return view(await db.assistantThread.update({ where: { id: empty.id }, data: { title: '新对话' } }));
  return view(await db.assistantThread.create({ data: {} }));
}
