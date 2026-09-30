import { describe, expect, it } from 'vitest';
import { enqueueAnalysis, isAnalysisActive } from '@/lib/benchmark/queue';

describe('analysis queue', () => {
  it('runs one at a time and refuses duplicates', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = async (id: string) => {
      order.push(`start ${id}`);
      if (id === 'a') await gate;
      order.push(`end ${id}`);
    };
    expect(enqueueAnalysis('a', run)).toBe(true);
    expect(enqueueAnalysis('a', run)).toBe(false);
    expect(enqueueAnalysis('b', run)).toBe(true);
    expect(isAnalysisActive('b')).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['start a']);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
    expect(isAnalysisActive('a')).toBe(false);
  });
});
