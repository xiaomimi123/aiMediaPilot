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
const fakeLLM = (responses: unknown[], usages: unknown[] = []) => {
  const remaining = [...responses];
  const remainingUsages = [...usages];
  const seen: string[] = [];
  return {
    seen,
    callStructured: async (opts: any) => {
      seen.push(opts.userMessage.map((p: any) => p.text ?? '').join('\n'));
      const next = remaining.shift();
      if (next === undefined) throw new Error('假 LLM 被多调了一次');
      return { result: next, usage: remainingUsages.shift() ?? {} };
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

/*
 * 「模型不碰 style」的第二重保证(三十二期 Task 2)必须在**集成路径**上钉住。
 *
 * 变异实测: 只对 stripPlanStyle 做纯函数单测时, 把 buildFilmPlan 里那句调用
 * 整个删掉, 测试照样全绿 —— 纯函数是对的、却没人验证它真的被调用了。
 * 这条用假 LLM 吐一份带 style 的 plan(模拟模型意外填了), 断言 buildFilmPlan
 * 的产出里 style 已被剥掉。
 */
describe('buildFilmPlan 剥掉模型产出的 style', () => {
  const withStyle = { shots: [{
    shotId: 's1', startMs: 0, endMs: 10000, card: 'statement',
    slots: { text: '三天赚五千?' }, style: { speed: 2, accent: 'red' },
  }] };

  it('模型意外填了 style 也不会进入产出', async () => {
    const llm = fakeLLM([withStyle]);
    const r = await buildFilmPlan({
      llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000,
    });
    expect(r.rounds).toBe(0);
    expect(r.plan.shots[0]).not.toHaveProperty('style');
    // 其余字段原样保留 —— 剥的是 style, 不是把整条镜头重建
    expect(r.plan.shots[0].slots).toEqual({ text: '三天赚五千?' });
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

  it('修复轮的 userMessage 带上原始台词/时间窗, 不只是 issue 文本', async () => {
    // 根因回归: 之前修复轮的 userMessage 整个替换成 issue 文本, 模型看不到原始
    // 台词和时间窗, 稿子长了以后会凭空编出短得多的方案。见 buildFilmPlan 里
    // `originalUserMessage` 的注释(180 秒六幕稿真机复现)。
    const llm = fakeLLM([badValue, good]);
    await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(llm.seen[1]).toContain('刷到过三天赚五千吗');
    expect(llm.seen[1]).toContain('slots.value');
  });

  it('completionTokens 逼近 maxTokens 时判定为截断, 直接抛错(不进修复循环)', async () => {
    const llm = fakeLLM([good], [{ completionTokens: 7900 }]);
    await expect(
      buildFilmPlan({
        llm: llm as any,
        windows,
        cardsSection: '卡片说明',
        factsSection: '',
        totalMs: 10000,
        maxTokens: 8192,
      }),
    ).rejects.toThrow(/截断/);
    // 只调了一次, 没有把截断产物喂进修复循环白烧轮次
    expect(llm.seen).toHaveLength(1);
  });

  it('不传 maxTokens 就不做截断检测(历史行为不变)', async () => {
    const llm = fakeLLM([good], [{ completionTokens: 999999 }]);
    const r = await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(r.rounds).toBe(0);
  });

  it('completionTokens 远低于 maxTokens 时不误判', async () => {
    const llm = fakeLLM([good], [{ completionTokens: 200 }]);
    const r = await buildFilmPlan({
      llm: llm as any,
      windows,
      cardsSection: '卡片说明',
      factsSection: '',
      totalMs: 10000,
      maxTokens: 8192,
    });
    expect(r.rounds).toBe(0);
  });
});
