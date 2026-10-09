import { describe, expect, it } from 'vitest';
import { predictScript, runPrediction, scriptSegments, segmentsHash, type PredictContext, type PredictDeps } from '@/lib/predict/run';
import { DEFAULT_PARAMS, DIMS } from '@/lib/predict/formula';
import type { Script } from '@/lib/script/model';
import type { StructuredLLM } from '@/lib/script/write';

const script: Script = {
  segments: [
    { id: 's1', role: 'hook', text: '一个U盘干到品类第一' },
    { id: 's2', role: 'context', text: '去年我盯了一个赛道' },
  ],
} as unknown as Script;
const llm: StructuredLLM = { callStructured: async () => ({ result: { scores: DIMS.map((dim) => ({ dim, score: 3, reason: 'x' })) }, usage: {} }) } as unknown as StructuredLLM;
const ctx: PredictContext = { persona: '', benchmark: '', benchmarkHit: false, baselines: {}, baselineViews: 3000, calibratedCount: 0, publicWorks: 5, formula: { version: 1, params: DEFAULT_PARAMS } } as unknown as PredictContext;

describe('predictScript', () => {
  it('scores a script without a project', async () => {
    const r = await predictScript(llm, '模型', ctx, scriptSegments(script, 60));
    expect(r.scores).toHaveLength(DIMS.length);
    expect(r.result.center).not.toBeNull();
    expect(r.formulaVersion).toBe(1);
  });
  it('predictScript hashes the same as a project prediction of that script', async () => {
    const segments = scriptSegments(script, 60);
    const saved: string[] = [];
    const deps: PredictDeps = {
      llm,
      modelLabel: '模型',
      load: async () => ({ ...ctx, published: false, segments, transcript: null }),
      save: async (row) => (saved.push(row.inputHash), { id: 'x' }),
      trimDrafts: async () => {},
    };
    await runPrediction(deps, 'p1', 'draft');
    expect(saved[0]).toBe((await predictScript(llm, '模型', ctx, segments)).inputHash);
    expect(saved[0]).toBe(segmentsHash(segments));
  });
});
