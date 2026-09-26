import { describe, expect, it, vi } from 'vitest';
import { writeScript, toScript, MAX_REPAIR_ROUNDS, type StructuredLLM } from '@/lib/script/write';

const onBudget = [30, 67, 67, 45, 67, 22];
const tooLong = [30, 67, 67, 187, 67, 22];
const raw = (lengths: number[]) => ({
  title: '让AI当反方',
  segments: lengths.map((n) => ({ role: 'hook' as const, text: '字'.repeat(n) })),
});

function fakeLLM(outputs: ReturnType<typeof raw>[]): StructuredLLM & { calls: string[] } {
  const calls: string[] = [];
  const fn = vi.fn(async (opts: { userMessage: { type: string; text?: string }[] }) => {
    calls.push(opts.userMessage.map((p) => p.text ?? '').join(''));
    const next = outputs.shift();
    if (!next) throw new Error('fake LLM ran out of outputs');
    return { result: next, usage: { model: 'fake', promptTokens: 0, completionTokens: 0, estCostUSD: 0 } };
  });
  return { callStructured: fn as unknown as StructuredLLM['callStructured'], calls };
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
});
