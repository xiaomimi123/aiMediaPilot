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
    expect(llm.calls[0]).toContain('原文念出来约 16.4 秒（82 字），目标 75 秒，全片不能超过 412 字');
    for (const s of ['只用原文里的内容，不加新内容', '不改用户的说法和口头禅', '改动必须全部列进 changes', '还超就删离题或次要的整句', '没改的地方不要列']) expect(llm.systems[0]).toContain(s);
  });

  it('drops listed "changes" that say nothing was changed', async () => {
    const changes = [{ kind: '错字', what: '「gpt」保留原文写法未改' }, { kind: '改', what: '「两眼一瞪」保留原说法' }, { kind: '删', what: '删了「然后」' }];
    const r = await polishScript({ llm: fakeLLM([out(sentences, { changes })]), text: original, targetSec: 75 });
    expect(r.changes).toEqual([{ kind: '删', what: '删了「然后」' }]);
    const real = [{ kind: '删', what: '删掉开头重复的一句，其余未改' }, { kind: '挪', what: '第二段未作删减，把结尾挪到开头' }, { kind: '改', what: '把「然后」改成「接着」，保留原意' }];
    const r2 = await polishScript({ llm: fakeLLM([out(sentences, { changes: real })]), text: original, targetSec: 75 });
    expect(r2.changes).toEqual(real);
  });

  it('drops a claimed deletion whose sentence is still in the polished script', async () => {
    const changes = [
      { kind: '删', what: '删去「那时候我做了一个自动上架商品的小工具」这句' },
      { kind: '删', what: '删了「我是一名程序员」' },
      { kind: '删', what: '删了重复的「然后」' },
    ];
    const kept = sentences.filter((x) => !x.startsWith('我是一名程序员'));
    const r = await polishScript({ llm: fakeLLM([out([...kept, '后来我学会了先让它写测试。'], { changes })]), text: original, targetSec: 75 });
    expect(r.changes).toEqual([changes[1], changes[2]]);
  });

  it('flags sentences that are not in the original', async () => {
    const llm = fakeLLM([out([...sentences.slice(0, 5), '这句是模型自己加的内容哦。'])]);
    const r = await polishScript({ llm, text: original, targetSec: 75 });
    expect(r.added).toEqual(['这句是模型自己加的内容哦']);
  });

  const filler = '字'.repeat(80) + '。';
  const long = sentences.map((x) => x + filler);
  const all = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}.2`);

  it('cuts by sentences the model picks, listing each removed sentence as a change', async () => {
    const llm = fakeLLM([out(long, { changes: [{ kind: '挪', what: '把结论挪到最后' }] }), { remove: all(6) }]);
    const r = await polishScript({ llm, text: original, targetSec: 75 });
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]).toContain('现在 562 字，至少要删掉 150 字');
    expect(llm.calls[1]).toContain(`[1.2]（80 字）${filler}`);
    expect(r.report.ok).toBe(true);
    expect(r.script.segments.map((x) => x.text)).toEqual(sentences);
    expect(r.changes[0]).toEqual({ kind: '挪', what: '把结论挪到最后' });
    expect(r.changes.slice(1)).toHaveLength(6);
    expect(r.changes[1]).toEqual({ kind: '删', what: `删了「${filler}」` });
  });

  it('asks again when the first pick is not enough, and never empties a segment', async () => {
    const llm = fakeLLM([out(long), { remove: ['1.2', '9.9', '2.1'] }, { remove: all(6) }]);
    const r = await polishScript({ llm, text: original, targetSec: 75 });
    expect(llm.calls).toHaveLength(3);
    expect(r.report.ok).toBe(true);
    expect(r.script.segments.every((x) => x.text.length > 0)).toBe(true);
  });

  it('gives back the over-long version when the cut round fails', async () => {
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
  it('splits text without punctuation at spaces, never inside a word', () => {
    const s = splitOriginal('alpha bravo charlie delta echo foxtrot golf hotel');
    expect(s.segments.every((x) => x.text.length > 0)).toBe(true);
    for (const x of s.segments) for (const w of x.text.split(' ')) expect(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']).toContain(w);
  });
  it('splits only the longest piece when there are fewer than 6 clauses', () => {
    const text = '第一句。第二句。第三句，有逗号，再一个很长很长的句子。';
    const s = splitOriginal(text);
    expect(s.segments.every((x) => x.text.length > 0)).toBe(true);
    expect(s.segments.map((x) => x.text).join('')).toBe(text);
    expect(s.segments.slice(0, 4).map((x) => x.text)).toEqual(['第一句。', '第二句。', '第三句，', '有逗号，']);
  });
  it('splits a text with few sentences at commas', () => {
    const s = splitOriginal('一二三，四五六，七八九，十十一，十二十三，十四十五，十六十七');
    expect(s.segments.every((x) => x.text.length > 0)).toBe(true);
  });
});
