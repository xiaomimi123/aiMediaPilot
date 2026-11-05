import { describe, expect, it } from 'vitest';
import { expandDraft, expandMessage } from '@/lib/draft/expand';
import { ExpandOutSchema } from '@/lib/draft/expand';

const llm = (result: unknown) => ({
  callStructured: async () => ({ result, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
});

describe('expandMessage', () => {
  it('带灵感且与正文不同时给出灵感块', () => {
    const m = expandMessage({ body: '正文开写了', ideaText: '原始一句灵感', targetSec: 75 });
    expect(m).toContain('【最初记下的灵感】');
    expect(m).toContain('原始一句灵感');
    expect(m).toContain('【草稿】');
  });

  it('灵感与正文相同或为空时不重复给', () => {
    expect(expandMessage({ body: '同文', ideaText: '同文', targetSec: 75 })).not.toContain('【最初记下的灵感】');
    expect(expandMessage({ body: '正文', ideaText: null, targetSec: 75 })).not.toContain('【最初记下的灵感】');
  });
});

describe('expandDraft', () => {
  it('返回模型结果', async () => {
    const out = await expandDraft({ llm: llm({ title: '标题', text: '稿子', questions: ['q1'] }) as never, body: '正文', targetSec: 75 });
    expect(out.title).toBe('标题');
    expect(out.questions).toEqual(['q1']);
  });

  it('空稿子报错', async () => {
    await expect(expandDraft({ llm: llm({ title: 't', text: '  ', questions: [] }) as never, body: '正文', targetSec: 75 })).rejects.toThrow('空稿子');
  });

  it('缺 text 字段时 schema 拒绝', () => {
    expect(ExpandOutSchema.safeParse({ title: 't', questions: [] }).success).toBe(false);
  });
});
