import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { listThreads, newThread } from '@/lib/assistant/threads';

type T = { id: string; title: string; updatedAt: Date; createdAt: Date; n: number };
function fakeDb(seed: T[]) {
  const rows = [...seed];
  let seq = 0;
  const withCount = (t: T) => ({ ...t, _count: { messages: t.n } });
  return {
    rows,
    db: {
      assistantThread: {
        findMany: async () => [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(withCount),
        findFirst: async ({ where }: { where: { messages: { none: object } } }) => (where.messages ? [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).find((t) => t.n === 0) ?? null : null),
        update: async ({ where }: { where: { id: string } }) => {
          const t = rows.find((x) => x.id === where.id)!;
          t.updatedAt = new Date('2026-10-09T00:00:00Z');
          return t;
        },
        create: async () => {
          const t = { id: `n${++seq}`, title: '新对话', updatedAt: new Date('2026-10-09T00:00:00Z'), createdAt: new Date('2026-10-09T00:00:00Z'), n: 0 };
          rows.push(t);
          return t;
        },
      },
    } as unknown as PrismaClient,
  };
}
const d = (s: string) => new Date(`2026-10-0${s}T00:00:00Z`);

describe('assistant threads', () => {
  const seed = (): T[] => [
    { id: 'a', title: '今天做什么', updatedAt: d('3'), createdAt: d('1'), n: 4 },
    { id: 'e1', title: '新对话', updatedAt: d('5'), createdAt: d('5'), n: 0 },
    { id: 'e2', title: '新对话', updatedAt: d('6'), createdAt: d('6'), n: 0 },
  ];
  it('hides empty threads except the one that is open', async () => {
    const { db } = fakeDb(seed());
    expect((await listThreads(db)).map((t) => t.id)).toEqual(['a']);
    expect((await listThreads(db, 'e1')).map((t) => t.id)).toEqual(['e1', 'a']);
  });
  it('reuses an empty thread instead of creating another', async () => {
    const { db, rows } = fakeDb(seed());
    expect((await newThread(db)).id).toBe('e2');
    expect(rows).toHaveLength(3);
  });
  it('creates a thread when there is no empty one', async () => {
    const { db, rows } = fakeDb([seed()[0]]);
    expect((await newThread(db)).id).toBe('n1');
    expect(rows).toHaveLength(2);
  });
});
