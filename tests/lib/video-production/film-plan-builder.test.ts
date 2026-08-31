import { describe, it, expect } from 'vitest';
import { buildFilmPlan, formatIssuesForModel, MAX_REPAIR_ROUNDS } from '@/lib/video-production/film-plan-builder';
import type { ActWindow } from '@/lib/video-production/film-plan-prompt';

const windows: ActWindow[] = [
  { act: 'hook', title: '钩子', startMs: 0, endMs: 10000, narration: '刷到过三天赚五千吗' },
];

const good = { shots: [{ shotId: 's1', startMs: 0, endMs: 10000, card: 'statement', slots: { text: '三天赚五千?' } }] };
// value 是字符串 —— 正是探针里模型真实犯过的那个错
const badValue = { shots: [{ shotId: 's1', startMs: 0, endMs: 10000, card: 'stat', slots: { label: '成交额', value: '900' } }] };
const gap = { shots: [
  { shotId: 's1', startMs: 0, endMs: 4000, card: 'statement', slots: { text: '一' } },
  { shotId: 's2', startMs: 6000, endMs: 10000, card: 'statement', slots: { text: '二' } },
] };

/** 按顺序吐出预设答案的假 LLM, 并记下每次收到的 user message。 */
const fakeLLM = (responses: unknown[]) => {
  const remaining = [...responses];
  const seen: string[] = [];
  return {
    seen,
    callStructured: async (opts: any) => {
      seen.push(opts.userMessage.map((p: any) => p.text ?? '').join('\n'));
      const next = remaining.shift();
      if (next === undefined) throw new Error('假 LLM 被多调了一次');
      return { result: next, usage: {} };
    },
  };
};

describe('formatIssuesForModel', () => {
  it('逐条列出, 不夹带别的卡片类型的噪音', () => {
    const text = formatIssuesForModel(['A 有问题', 'B 有问题']);
    expect(text).toContain('A 有问题');
    expect(text).toContain('B 有问题');
    expect(text).not.toContain('invalid_union');
  });
});

describe('buildFilmPlan', () => {
  it('一次就对时不重试', async () => {
    const llm = fakeLLM([good]);
    const r = await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(r.rounds).toBe(0);
    expect(r.plan.shots).toHaveLength(1);
    expect(llm.seen).toHaveLength(1);
  });

  it('schema 错误被喂回后收敛, 且喂回的是精准的那一条', async () => {
    const llm = fakeLLM([badValue, good]);
    const r = await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(r.rounds).toBe(1);
    expect(llm.seen[1]).toContain('slots.value');
    // 关键: 不许把"这镜该用 statement"这类会让模型弃卡的噪音喂回去
    expect(llm.seen[1]).not.toContain('Unrecognized key');
    expect(llm.seen[1]).not.toContain('expected "statement"');
  });

  it('时间轴空档也会被喂回', async () => {
    const llm = fakeLLM([gap, good]);
    const r = await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(r.rounds).toBe(1);
    expect(llm.seen[1]).toContain('4000');
    expect(llm.seen[1]).toContain('6000');
  });

  it('修满 MAX_REPAIR_ROUNDS 仍不对就抛错, 错误里带最后一轮的问题', async () => {
    const llm = fakeLLM([badValue, badValue, badValue]);
    await expect(
      buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 }),
    ).rejects.toThrow(/slots\.value/);
    expect(llm.seen).toHaveLength(MAX_REPAIR_ROUNDS + 1);
  });
});
