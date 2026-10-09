import { describe, expect, it, vi } from 'vitest';
import { writeScript, toScript, MAX_REPAIR_ROUNDS, type StructuredLLM } from '@/lib/script/write';

const onBudget = [30, 67, 67, 45, 67, 22];
const tooLong = [30, 67, 67, 187, 67, 22];
const raw = (lengths: number[]) => ({
  title: '让AI当反方',
  segments: lengths.map((n) => ({ role: 'hook' as const, text: '字'.repeat(n) })),
});

function fakeLLM(outputs: (ReturnType<typeof raw> | Error)[]): StructuredLLM & { calls: string[]; systems: string[] } {
  const calls: string[] = [];
  const systems: string[] = [];
  const fn = vi.fn(async (opts: { systemPrompt: string; userMessage: { type: string; text?: string }[] }) => {
    calls.push(opts.userMessage.map((p) => p.text ?? '').join(''));
    systems.push(opts.systemPrompt);
    const next = outputs.shift();
    if (!next) throw new Error('fake LLM ran out of outputs');
    if (next instanceof Error) throw next;
    return { result: next, usage: { model: 'fake', promptTokens: 0, completionTokens: 0, estCostUSD: 0 } };
  });
  return { callStructured: fn as unknown as StructuredLLM['callStructured'], calls, systems };
}

describe('toScript', () => {
  it('forces roles by position and assigns stable ids', () => {
    const s = toScript(raw(onBudget));
    expect(s.segments.map((x) => x.role)).toEqual(['hook', 'conceptA', 'conceptB', 'fact', 'bridge', 'close']);
    expect(s.segments.map((x) => x.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
  });
});

describe('writeScript', () => {
  it('asks to sound like the blogger talking, not an article', async () => {
    const llm = fakeLLM([raw(onBudget)]);
    await writeScript({ llm, direction: 'x', targetSec: 75, personaText: '' });
    for (const s of ['写得像博主本人在说话，不像文章', '先交代「我是谁、我当时在干嘛」', '不写「其实」「所以结论很直接」', '用具体的东西', '模仿它的节奏']) expect(llm.systems[0]).toContain(s);
  });

  it('includes speaking samples and the user answers, skipping unanswered questions', async () => {
    const llm = fakeLLM([raw(onBudget)]);
    await writeScript({ llm, direction: 'x', targetSec: 75, personaText: '定位', samples: ['样本一原文', '样本二原文'], answers: [{ q: '你收藏了多少？', a: '一百多个' }, { q: '留下哪几个？', a: ' ' }] });
    expect(llm.calls[0]).toContain('【说话样本】（模仿说话方式，不抄句子）\n样本一原文\n---\n样本二原文');
    expect(llm.calls[0].indexOf('【账号定位】')).toBeLessThan(llm.calls[0].indexOf('【说话样本】'));
    expect(llm.calls[0]).toContain('【用户的回答】（是事实，经历和数字可以从这里取）\n问：你收藏了多少？\n答：一百多个');
    expect(llm.calls[0]).not.toContain('留下哪几个');
  });

  it('leaves samples and answers out when none are given', async () => {
    const llm = fakeLLM([raw(onBudget)]);
    await writeScript({ llm, direction: 'x', targetSec: 75, personaText: '', samples: [], answers: [] });
    expect(llm.calls[0]).not.toContain('【说话样本】');
    expect(llm.calls[0]).not.toContain('【用户的回答】');
  });

  it('returns first draft when it is on budget', async () => {
    const llm = fakeLLM([raw(onBudget)]);
    const r = await writeScript({ llm, direction: '让AI挑刺', targetSec: 60, personaText: '' });
    expect(r.rounds).toBe(0);
    expect(r.report.ok).toBe(true);
    expect(r.title).toBe('让AI当反方');
    expect(llm.calls).toHaveLength(1);
  });

  it('repairs with the issue text fed back, then succeeds', async () => {
    const llm = fakeLLM([raw(tooLong), raw(onBudget)]);
    const r = await writeScript({ llm, direction: '让AI挑刺', targetSec: 60, personaText: '' });
    expect(r.rounds).toBe(1);
    expect(r.report.ok).toBe(true);
    expect(llm.calls[1]).toContain('第4段「怎么做的」约 37.4 秒，参考 12 秒');
  });

  it('gives up after MAX_REPAIR_ROUNDS and reports honestly', async () => {
    const llm = fakeLLM([raw(tooLong), raw(tooLong), raw(tooLong)]);
    const r = await writeScript({ llm, direction: '让AI挑刺', targetSec: 60, personaText: '' });
    expect(r.rounds).toBe(MAX_REPAIR_ROUNDS);
    expect(r.report.ok).toBe(false);
    expect(llm.calls).toHaveLength(1 + MAX_REPAIR_ROUNDS);
  });

  it('keeps the last valid draft when a repair round fails', async () => {
    const llm = fakeLLM([raw(tooLong), new Error('[{"code":"too_small"}]')]);
    const r = await writeScript({ llm, direction: '让AI挑刺', targetSec: 60, personaText: '' });
    expect(r.report.ok).toBe(false);
    expect(r.script.segments[3].text).toHaveLength(187);
  });

  it('throws a plain-Chinese error when not even a first draft can be produced', async () => {
    const llm = fakeLLM([new Error('[{"code":"too_small","minimum":6}]')]);
    await expect(writeScript({ llm, direction: '让AI挑刺', targetSec: 60, personaText: '' })).rejects.toThrow(
      '模型这次没按 6 段格式交稿，没写成。再说一次，或者把方向说具体些。',
    );
  });

  it('forbids inventing first-person experiences in the system prompt', async () => {
    const llm = fakeLLM([raw(onBudget)]);
    await writeScript({ llm, direction: '让AI挑刺', targetSec: 60, personaText: '' });
    expect(llm.systems[0]).toContain('【待补：你的真实经历】');
  });
  it('keeps supplied facts apart from the direction and only allows experiences from the facts', async () => {
    const llm = fakeLLM([raw(onBudget)]);
    await writeScript({ llm, direction: '我拿同一道题跑了三档，结果很意外', targetSec: 60, personaText: '例：帮妈妈写广场舞通知', facts: '讲讲 vibe coding 两年半踩过的坑' });
    expect(llm.calls[0]).toContain('【用户提供的事实】\n讲讲 vibe coding 两年半踩过的坑');
    expect(llm.calls[0]).toContain('（选题方向，不是事实；里面提到的经历、测试结果、数字都只是设想，不能当成真的写进稿子）');
    expect(llm.systems[0]).toContain('有【用户提供的事实】或【用户的回答】时：稿子里的第一人称经历、测试结果、数字只能来自这两处');
    expect(llm.systems[0]).toContain('账号定位里举的例子是描述受众和方向的，不是用户的经历');
  });
  it('keeps the old message shape when no facts are given', async () => {
    const llm = fakeLLM([raw(onBudget)]);
    await writeScript({ llm, direction: '让AI挑刺', targetSec: 60, personaText: '' });
    expect(llm.calls[0]).not.toContain('【用户提供的事实】');
    expect(llm.calls[0]).toContain('【这条讲什么】\n让AI挑刺');
  });
});
