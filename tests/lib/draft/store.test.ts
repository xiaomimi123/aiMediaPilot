import { describe, expect, it } from 'vitest';
import { createDraft, draftFromIdea, updateDraft, type DraftView } from '@/lib/draft/store';

/** store 只用到 draft / topicIdea 两个委托, 内存实现足够 */
function makeDb(seed: { ideas?: { id: string; text: string; status: string }[] } = {}) {
  const drafts: (Record<string, unknown> & { id: string })[] = [];
  const ideas = (seed.ideas ?? []).map((i) => ({ ...i }));
  let seq = 0;
  const now = () => new Date(Date.now() + ++seq);
  return {
    drafts,
    ideas,
    draft: {
      findUnique: async ({ where }: { where: { id: string } }) => drafts.find((d) => d.id === where.id) ?? null,
      findMany: async () => [...drafts].sort((a, b) => (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime()),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const d = { id: `d${++seq}`, title: '', body: '', source: 'blank', ideaId: null, status: 'blank', ...data, createdAt: now(), updatedAt: now() };
        drafts.push(d);
        return d;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const d = drafts.find((x) => x.id === where.id);
        if (!d) throw new Error('not found');
        Object.assign(d, data, { updatedAt: now() });
        return d;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = drafts.findIndex((x) => x.id === where.id);
        if (i < 0) throw new Error('not found');
        return drafts.splice(i, 1)[0];
      },
    },
    topicIdea: {
      findUnique: async ({ where }: { where: { id: string } }) => ideas.find((i) => i.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const i = ideas.find((x) => x.id === where.id);
        if (!i) throw new Error('not found');
        Object.assign(i, data);
        return i;
      },
    },
  };
}

const view = (d: unknown) => d as DraftView;

describe('draft store', () => {
  it('createDraft 截断超长正文、标题去首尾空白', async () => {
    const db = makeDb();
    const d = view(await createDraft(db as never, { title: '  标题  ', body: '正'.repeat(20001) }));
    expect(d.title).toBe('标题');
    expect(d.body.length).toBe(20000);
  });

  it('updateDraft 空标题不覆盖已有标题, 空 patch 返回原样', async () => {
    const db = makeDb();
    const d = view(await createDraft(db as never, { title: '原标题', body: '正文' }));
    const u = view(await updateDraft(db as never, d.id, { title: '  ', body: '新正文' }));
    expect(u.title).toBe('原标题');
    expect(u.body).toBe('新正文');
    const same = view(await updateDraft(db as never, d.id, {}));
    expect(same.body).toBe('新正文');
  });

  it('updateDraft 不存在的草稿返回 null', async () => {
    const db = makeDb();
    expect(await updateDraft(db as never, 'nope', { body: 'x' })).toBeNull();
  });

  it('draftFromIdea 带出点子文本并把 fresh 标成 used', async () => {
    const db = makeDb({ ideas: [{ id: 'i1', text: '做一期 AI 配音的坑', status: 'fresh' }] });
    const d = view(await draftFromIdea(db as never, 'i1'));
    expect(d.source).toBe('idea');
    expect(d.ideaId).toBe('i1');
    expect(d.body).toContain('AI 配音的坑');
    expect(db.ideas[0].status).toBe('used');
  });

  it('draftFromIdea 点子不存在时抛错', async () => {
    const db = makeDb();
    await expect(draftFromIdea(db as never, 'nope')).rejects.toThrow('点子不存在');
  });

  it('draftFromIdea 已 used 的点子再展开不重复改状态', async () => {
    const db = makeDb({ ideas: [{ id: 'i1', text: 'x', status: 'used' }] });
    await draftFromIdea(db as never, 'i1');
    expect(db.ideas[0].status).toBe('used');
  });
});
