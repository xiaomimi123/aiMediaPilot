import { describe, expect, it } from 'vitest';
import { editDistance, acceptCorrection, proofreadLines } from '@/lib/recording/proofread';
import type { StructuredLLM } from '@/lib/script/write';
import { SEGMENT_ROLES, type Script } from '@/lib/script/model';

const script: Script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: `第${i + 1}段，今天讲赛道和类目第一` })) };
const lines = [
  { startSec: 0, endSec: 2, text: '今天讲室看' },
  { startSec: 2, endSec: 4, text: '做到LAM第一' },
];
const llmReturning = (value: unknown): StructuredLLM => ({
  callStructured: (async () => {
    if (value instanceof Error) throw value;
    return { result: value, usage: { model: 'fake', promptTokens: 0, completionTokens: 0, estCostUSD: 0 } };
  }) as unknown as StructuredLLM['callStructured'],
});

describe('editDistance / acceptCorrection', () => {
  it('computes Levenshtein distance', () => {
    expect(editDistance('今天讲室看', '今天讲赛道')).toBe(2);
    expect(editDistance('', 'ab')).toBe(2);
  });
  it('accepts a small word-level fix', () => {
    expect(acceptCorrection('今天讲室看', '今天讲赛道')).toBe('今天讲赛道');
  });
  it('rejects a rewrite and keeps what was actually said', () => {
    expect(acceptCorrection('今天讲室看', '我们今天来深入聊一聊赛道选择')).toBe('今天讲室看');
  });
  it('rejects an empty correction', () => {
    expect(acceptCorrection('今天讲室看', '  ')).toBe('今天讲室看');
  });
});

describe('proofreadLines', () => {
  it('applies accepted fixes and counts them, keeping timestamps', async () => {
    const r = await proofreadLines(llmReturning({ lines: ['今天讲赛道', '做到类目第一'] }), script, lines);
    expect(r.status).toBe('done');
    expect(r.changed).toBe(2);
    expect(r.lines).toEqual([
      { startSec: 0, endSec: 2, text: '今天讲赛道' },
      { startSec: 2, endSec: 4, text: '做到类目第一' },
    ]);
  });
  it('keeps the raw lines when the model returns a different line count', async () => {
    const r = await proofreadLines(llmReturning({ lines: ['只有一行'] }), script, lines);
    expect(r).toMatchObject({ status: 'failed', changed: 0, lines });
  });
  it('keeps the raw lines when the call fails', async () => {
    const r = await proofreadLines(llmReturning(new Error('timeout')), script, lines);
    expect(r).toMatchObject({ status: 'failed', lines });
  });
  it('skips when there is no script to compare with', async () => {
    const r = await proofreadLines(llmReturning({ lines: [] }), null, lines);
    expect(r).toMatchObject({ status: 'skipped', lines });
  });
});
