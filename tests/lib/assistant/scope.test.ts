import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { assistantScope } from '@/lib/assistant/scope';

function fakeDb() {
  const thread = { id: 't1', title: '新对话', updatedAt: new Date(0) };
  const msgs: { role: string; content: string; toolName: string | null; createdAt: Date }[] = [];
  let seq = 0;
  const db = {
    assistantThread: {
      findUnique: async () => ({ ...thread }),
      update: async ({ data }: { data: Partial<typeof thread> }) => Object.assign(thread, data),
    },
    assistantMessage: {
      create: async ({ data }: { data: { role: string; content: string; toolName?: string } }) =>
        void msgs.push({ role: data.role, content: data.content, toolName: data.toolName ?? null, createdAt: new Date(++seq) }),
      findMany: async ({ take }: { take: number }) => [...msgs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take),
    },
  } as unknown as PrismaClient;
  return { db, thread, msgs };
}

describe('assistantScope', () => {
  it('titles the thread from the first user message only', async () => {
    const { db, thread } = fakeDb();
    const s = assistantScope(db, 't1');
    await s.save({ role: 'user', content: '今天有什么爆款？顺便看看昨晚回采成功没有，还有上周那条复盘怎么样了，给我三条建议' });
    expect(thread.title).toBe('今天有什么爆款？顺便看看昨晚回采成功没有，还有上周那条复盘怎');
    await s.save({ role: 'user', content: '第二句' });
    expect(thread.title).toBe('今天有什么爆款？顺便看看昨晚回采成功没有，还有上周那条复盘怎');
  });
  it('loads history oldest-first and turns tool rows into notes', async () => {
    const { db } = fakeDb();
    const s = assistantScope(db, 't1');
    await s.save({ role: 'user', content: '你好' });
    await s.save({ role: 'tool', content: '概况：粉丝 408', toolName: 'status' });
    await s.save({ role: 'assistant', content: '粉丝 408' });
    expect(await s.loadHistory()).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '（已执行 status：概况：粉丝 408）' },
      { role: 'assistant', content: '粉丝 408' },
    ]);
  });
});
