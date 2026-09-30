import { describe, expect, it } from 'vitest';
import { PREDICT_COMMANDS, formatPredictList } from '@/lib/cli/commands/predict';

describe('mp predict', () => {
  it('registers run/show/list with the right tiers', () => {
    expect(PREDICT_COMMANDS.map((c) => [c.path.join(' '), c.tier, c.hermes])).toEqual([
      ['predict run', 'write', false],
      ['predict show', 'read', true],
      ['predict list', 'read', true],
    ]);
  });
  it('lists by center, unknowns last', () => {
    expect(formatPredictList([
      { id: 'a', title: 'A', kind: 'final', center: 1000, top: '<1,450 60%' },
      { id: 'b', title: 'B', kind: 'recorded', center: 5000, top: '2,900–1.5万 50%' },
      { id: 'c', title: 'C', kind: 'draft', center: null, top: null },
    ])).toBe(['[b] B · 录制后预测 · 中枢约 5,000 · 最可能 2,900–1.5万 50%', '[a] A · 定稿预测 · 中枢约 1,000 · 最可能 <1,450 60%', '[c] C · 草稿预测 · 暂不预测数字'].join('\n'));
    expect(formatPredictList([])).toBe('没有待发布的项目。');
  });
  it('refuses to run while the page is already predicting', async () => {
    const run = PREDICT_COMMANDS.find((c) => c.path.join(' ') === 'predict run')!;
    const db = { job: { findFirst: async () => ({ id: 'j1' }) } } as never;
    await expect(run.run({ db, agent: 'claude-code', now: new Date(), progress: () => {}, write: () => {} }, { positionals: ['p1'], flags: {} })).rejects.toThrow('正在预测');
  });
});
