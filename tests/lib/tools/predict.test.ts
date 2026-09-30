import { describe, expect, it } from 'vitest';
import { makePredictTool } from '@/lib/tools/predict';
import { DEFAULT_PARAMS } from '@/lib/predict/formula';

const five = ['hook', 'pace', 'ending', 'interaction', 'topic'].map((dim) => ({ dim, score: 3, reason: 'r', quote: '', segmentId: null, fix: '' }));
const ctx = { projectId: 'p1', db: {} as never, llm: {} as never };
const deps = (published = false) => async () => ({
  load: async () => ({ published, segments: [{ id: 's1', label: '开场钩子', text: 't', estSec: 5 }], transcript: null, persona: '', benchmark: '', benchmarkHit: false, baselines: {}, baselineViews: 2900, calibratedCount: 0, formula: { version: 1, params: DEFAULT_PARAMS } }),
  llm: { callStructured: async () => ({ result: { scores: five }, usage: {} }) } as never,
  modelLabel: 'M',
  save: async () => ({ id: 'pr1' }),
  trimDrafts: async () => {},
});

describe('predict_views tool', () => {
  it('runs a draft prediction and returns the detail text', async () => {
    const r = await makePredictTool(deps()).execute(ctx, {});
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/^草稿预测：中枢约 2,900/);
    expect((r.data as { text: string }).text).toContain('开头钩子 3 分');
  });
  it('fails readably once published', async () => {
    expect(await makePredictTool(deps(true)).execute(ctx, {})).toMatchObject({ ok: false, summary: '预测失败：已经有数据了，这时再预测不算数' });
  });
});
