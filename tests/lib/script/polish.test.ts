import { describe, expect, it, vi } from 'vitest';
import { findAdded, polishScript, splitOriginal } from '@/lib/script/polish';
import { SEGMENT_ROLES } from '@/lib/script/model';
import type { StructuredLLM } from '@/lib/script/write';

const original = '我是一名程序员。两年半前我开始用AI写代码。那时候我做了一个自动上架商品的小工具。结果它把库存全清空了，我两眼一瞪非常懵逼。后来我学会了先让它写测试。我擅长描述问题，它擅长解决问题。';
const sentences = original.split('。').filter(Boolean).map((s) => `${s}。`);

const out = (segments: string[], extra: Partial<{ changes: unknown[]; questions: string[]; title: string }> = {}) => ({
  title: extra.title ?? '两年半',
  segments: segments.map((text) => ({ text })),
  changes: extra.changes ?? [],
  questions: extra.questions ?? [],
});

function fakeLLM(outputs: unknown[]): StructuredLLM & { calls: string[]; systems: string[] } {
  const calls: string[] = [];
  const systems: string[] = [];
  const fn = vi.fn(async (o: { systemPrompt: string; userMessage: { text?: string }[] }) => {
    calls.push(o.userMessage.map((p) => p.text ?? '').join(''));
    systems.push(o.systemPrompt);
    const next = outputs.shift();
    if (!next) throw new Error('no more');
    if (next instanceof Error) throw next;
    return { result: next, usage: {} };
  });
  return { callStructured: fn as unknown as StructuredLLM['callStructured'], calls, systems };
}

describe('polishScript', () => {
  it('returns a 6-beat script with every change listed and questions to confirm', async () => {
    const changes = [{ kind: '删', what: '删了重复的「然后」' }, { kind: '错字', what: '「在」改成「再」' }];
    const llm = fakeLLM([out(sentences, { changes, questions: ['两年半和 GPT 上线的时间对不上，哪个对？'] })]);
    const r = await polishScript({ llm, text: original, targetSec: 75 });
    expect(r.script.segments.map((s) => s.role)).toEqual([...SEGMENT_ROLES]);
    expect(r.changes).toEqual(changes);
    expect(r.questions).toEqual(['两年半和 GPT 上线的时间对不上，哪个对？']);
    expect(r.added).toEqual([]);
    expect(r.title).toBe('两年半');
    expect(llm.calls[0]).toContain(`【原文】\n${original}`);
    for (const s of ['只用原文里的内容，不加新内容', '不改用户的说法和口头禅', '改动必须全部列进 changes']) expect(llm.systems[0]).toContain(s);
  });

  it('flags sentences that are not in the original', async () => {
    const llm = fakeLLM([out([...sentences.slice(0, 5), '这句是模型自己加的内容哦。'])]);
    const r = await polishScript({ llm, text: original, targetSec: 75 });
    expect(r.added).toEqual(['这句是模型自己加的内容哦']);
  });

  it('repairs once when still over the target, keeping both rounds of changes', async () => {
    const long = sentences.map((s) => s + '字'.repeat(80));
    const llm = fakeLLM([out(long, { changes: [{ kind: '挪', what: '把结论挪到最后' }] }), out(sentences, { changes: [{ kind: '删', what: '删了啰嗦的话' }] })]);
    const r = await polishScript({ llm, text: original, targetSec: 75 });
    expect(llm.calls).toHaveLength(2);
    expect(r.report.ok).toBe(true);
    expect(r.changes.map((c) => c.kind)).toEqual(['挪', '删']);
  });

  it('gives back the over-long version when the repair round fails', async () => {
    const long = sentences.map((s) => s + '字'.repeat(80));
    const llm = fakeLLM([out(long), new Error('bad json')]);
    const r = await polishScript({ llm, text: original, targetSec: 75 });
    expect(r.report.ok).toBe(false);
  });

  it('refuses empty text', async () => {
    await expect(polishScript({ llm: fakeLLM([]), text: '  ', targetSec: 75 })).rejects.toThrow('稿子是空的');
  });

  it('explains in Chinese when the model does not return a usable draft', async () => {
    await expect(polishScript({ llm: fakeLLM([new Error('zod: Expected array')]), text: original, targetSec: 75 })).rejects.toThrow('模型这次没交回能用的润色稿');
  });
});

describe('findAdded', () => {
  it('finds runs of 12+ characters the original does not have', () => {
    expect(findAdded('我是一名程序员。这句是模型自己加的内容哦。', original)).toEqual(['这句是模型自己加的内容哦']);
  });
  it('does not flag trimmed or reordered original sentences', () => {
    expect(findAdded('我擅长描述问题，它擅长解决问题。我是程序员，两年半前开始用AI写代码。', original)).toEqual([]);
  });
});

describe('splitOriginal', () => {
  it('keeps every character in 6 segments', () => {
    const s = splitOriginal(original);
    expect(s.segments.map((x) => x.role)).toEqual([...SEGMENT_ROLES]);
    expect(s.segments.every((x) => x.text.length > 0)).toBe(true);
    expect(s.segments.map((x) => x.text).join('').replace(/\s/g, '')).toBe(original.replace(/\s/g, ''));
  });
  it('splits a text with few sentences at commas', () => {
    const s = splitOriginal('一二三，四五六，七八九，十十一，十二十三，十四十五，十六十七');
    expect(s.segments.every((x) => x.text.length > 0)).toBe(true);
  });
});
