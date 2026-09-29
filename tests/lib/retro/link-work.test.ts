import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { linkWork } from '@/lib/retro/match';

function fakeDb(works: { id: string; projectId: string | null }[]) {
  const notices: string[] = [];
  const db = {
    publishedWork: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ ...works.find((w) => w.id === where.id)!, title: 't', caption: '', publishedAt: new Date() }),
      findFirst: async ({ where }: { where: { projectId: string; id?: { not: string } } }) => works.find((w) => w.projectId === where.projectId && w.id !== where.id?.not) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { projectId: string } }) => {
        works.find((w) => w.id === where.id)!.projectId = data.projectId;
      },
    },
    project: { findUniqueOrThrow: async () => ({ stage: 'final' }), update: async () => {} },
    chatMessage: { create: async ({ data }: { data: { content: string } }) => void notices.push(data.content) },
  } as unknown as PrismaClient;
  return { db, notices, works };
}

describe('linkWork', () => {
  it('refuses a second, different work for the same project', async () => {
    const { db } = fakeDb([{ id: 'w1', projectId: 'p1' }, { id: 'w2', projectId: null }]);
    await expect(linkWork(db, 'p1', 'w2')).rejects.toThrow('这个项目已经关联了一条作品');
  });
  it('is a no-op when the same work is linked again (double click)', async () => {
    const { db, notices } = fakeDb([{ id: 'w1', projectId: null }]);
    await linkWork(db, 'p1', 'w1');
    await linkWork(db, 'p1', 'w1');
    expect(notices).toHaveLength(1);
  });
});
