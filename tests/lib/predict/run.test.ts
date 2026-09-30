import { describe, expect, it, vi } from 'vitest';
import { runPrediction, PredictRefused, type PredictDeps, type PredictInput } from '@/lib/predict/run';
import { DEFAULT_PARAMS } from '@/lib/predict/formula';

const five = ['hook', 'pace', 'ending', 'interaction', 'topic'].map((dim) => ({ dim, score: 3, reason: 'r', quote: '', segmentId: null, fix: '' }));
const input = (over: Partial<PredictInput> = {}): PredictInput => ({
  published: false,
  segments: [{ id: 's1', label: '开场钩子', text: 't', estSec: 5 }],
  transcript: null,
  persona: '',
  benchmark: '',
  benchmarkHit: false,
  baselines: { hook2s: 0.4 },
  baselineViews: 2900,
  calibratedCount: 0,
  formula: { version: 1, params: DEFAULT_PARAMS },
  ...over,
});

function deps(over: Partial<PredictDeps> = {}, callStructured = vi.fn(async () => ({ result: { scores: five }, usage: {} }))) {
  const saved: unknown[] = [];
  const trimmed: string[] = [];
  const d: PredictDeps = {
    load: async () => input(),
    llm: { callStructured } as never,
    modelLabel: 'DeepSeek',
    save: async (row) => (saved.push(row), { id: `pr${saved.length}` }),
    trimDrafts: async (p) => void trimmed.push(p),
    ...over,
  };
  return { d, saved, trimmed, callStructured };
}

describe('runPrediction', () => {
  it('scores, computes and saves a locked prediction', async () => {
    const { d, saved, trimmed } = deps();
    const r = await runPrediction(d, 'p1', 'final');
    expect(r.id).toBe('pr1');
    expect(saved[0]).toMatchObject({ projectId: 'p1', kind: 'final', formulaVersion: 1 });
    expect((saved[0] as { inputHash: string }).inputHash).toMatch(/^[0-9a-f]{12}$/);
    expect(r.summary).toContain('定稿预测：中枢约 2,900');
    expect(trimmed).toEqual([]);
  });
  it('trims drafts after a draft prediction', async () => {
    const { d, trimmed } = deps();
    await runPrediction(d, 'p1', 'draft');
    expect(trimmed).toEqual(['p1']);
  });
  it('refuses once the work is published, without calling the model', async () => {
    const { d, callStructured } = deps({ load: async () => input({ published: true }) });
    await expect(runPrediction(d, 'p1', 'draft')).rejects.toThrow('已经有数据了，这时再预测不算数');
    expect(callStructured).not.toHaveBeenCalled();
  });
  it('refuses without a script or a transcript', async () => {
    await expect(runPrediction(deps({ load: async () => input({ segments: null }) }).d, 'p1', 'final')).rejects.toThrow('还没有稿子，不能预测');
    await expect(runPrediction(deps({ load: async () => input({ segments: null }) }).d, 'p1', 'recorded')).rejects.toThrow('还没有转写，不能按口播预测');
    await expect(runPrediction(deps({ llm: null }).d, 'p1', 'draft')).rejects.toThrow(PredictRefused);
  });
  it('retries a round when fewer than two of three scorings succeed', async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error('bad json')).mockRejectedValueOnce(new Error('bad json')).mockResolvedValue({ result: { scores: five }, usage: {} });
    const { d, saved } = deps({}, call);
    await runPrediction(d, 'p1', 'draft');
    expect(call).toHaveBeenCalledTimes(6);
    expect(saved).toHaveLength(1);
  });
  it('fails without saving when scoring keeps failing', async () => {
    const call = vi.fn(async () => { throw new Error('schema mismatch'); });
    const { d, saved } = deps({}, call);
    await expect(runPrediction(d, 'p1', 'draft')).rejects.toThrow('模型没按格式打分');
    expect(saved).toEqual([]);
  });
  it('explains model connection errors instead', async () => {
    const call = vi.fn(async () => { throw Object.assign(new Error('401 Unauthorized'), { status: 401 }); });
    await expect(runPrediction(deps({}, call).d, 'p1', 'draft')).rejects.toThrow('DeepSeek拒绝了请求');
  });
  it('does not call an unknown model error a format error', async () => {
    const call = vi.fn(async () => { throw new Error('socket hang up somewhere odd'); });
    const e = (await runPrediction(deps({}, call).d, 'p1', 'draft').catch((x) => x)) as Error;
    expect(e.message).toContain('socket hang up');
    expect(e.message).not.toContain('没按格式');
  });
  it('takes the per-dimension median of three scorings', async () => {
    const withHook = (score: number) => ({ result: { scores: five.map((s) => (s.dim === 'hook' ? { ...s, score, reason: `hook=${score}` } : s)) }, usage: {} });
    const call = vi.fn().mockResolvedValueOnce(withHook(2)).mockResolvedValueOnce(withHook(5)).mockResolvedValueOnce(withHook(3));
    const r = await runPrediction(deps({}, call).d, 'p1', 'draft');
    expect(call).toHaveBeenCalledTimes(3);
    expect(r.scores.find((s) => s.dim === 'hook')).toMatchObject({ score: 3, reason: 'hook=3' });
  });
  it('reuses scores when the text has not changed', async () => {
    const call = vi.fn(async () => ({ result: { scores: five }, usage: {} }));
    const kept = five.map((s) => ({ ...s, score: 4 }));
    const findScores = vi.fn(async () => kept as never);
    const r = await runPrediction(deps({ findScores }, call).d, 'p1', 'final');
    expect(call).not.toHaveBeenCalled();
    expect(r.scores).toEqual(kept);
    expect(findScores).toHaveBeenCalledWith('p1', expect.stringMatching(/^[0-9a-f]{12}$/));
  });
  it('runs predictions for one project one at a time', async () => {
    let active = 0;
    let maxActive = 0;
    const { d } = deps({
      load: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        return input();
      },
      save: async () => {
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return { id: 'x' };
      },
    });
    await Promise.all([runPrediction(d, 'p1', 'draft'), runPrediction(d, 'p1', 'draft')]);
    expect(maxActive).toBe(1);
  });
  it('says numbers need more works when there is no view baseline', async () => {
    const { d } = deps({ load: async () => input({ baselineViews: null, publicWorks: 1 }) });
    expect((await runPrediction(d, 'p1', 'draft')).summary).toContain('公开作品少于 3 条，再发 2 条就能预测数字');
  });
});
