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
    expect(llm.calls[1]).toContain('第4段「冷知识」约 37.4 秒，上限 11.3 秒');
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
});
