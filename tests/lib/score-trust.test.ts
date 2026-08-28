import { describe, it, expect } from 'vitest';
import { scoreHardDimensions } from '@/lib/cockpit/script-score';
import { ACT_KEYS } from '@/lib/script/six-act';

function actsOf(map: Partial<Record<string, string>>) {
  return ACT_KEYS.map((act) => ({
    act, title: '', narration: map[act] ?? '', visual: '', note: '',
    targetSec: 10, beats: [], facts: [],
  }));
}

const dim = (acts: ReturnType<typeof actsOf>, key: string) =>
  scoreHardDimensions(acts, 60).dimensions.find((d) => d.key === key);

describe('信任声明: 只在讲变现的稿子上才成立', () => {
  it('不讲钱的稿子, 这条整个不出现 —— 不是所有好口播都要说「不卖课」', () => {
    const acts = actsOf({
      hook: '很多人以为向量数据库很复杂。',
      concept_a: '它做的事情只有一件：把文本变成一串数字，再找最近的邻居。',
      punchline: '复杂的是工程，不是原理。',
    });
    expect(dim(acts, 'trust')).toBeUndefined();
  });

  it('不出现时满分随之减少, 而不是白扣 6 分', () => {
    const acts = actsOf({ hook: '向量数据库其实很简单。', concept_a: '它只做一件事。' });
    const r = scoreHardDimensions(acts, 60);
    expect(r.max).toBe(29);
  });

  it('讲了变现的稿子, 这条照常出现', () => {
    const acts = actsOf({
      hook: '我做了个U盘。',
      synthesis: '结果卖了六千多单。',
    });
    expect(dim(acts, 'trust')).toBeDefined();
    expect(scoreHardDimensions(acts, 60).max).toBe(35);
  });
});

describe('信任声明: 「没卖课」也要认', () => {
  it('「我没卖课，也没收徒」应当得分 —— 只认「不卖课」是漏判', () => {
    const acts = actsOf({
      hook: '我没卖课，也没收徒。',
      synthesis: '结果卖了六千多单。',
    });
    const d = dim(acts, 'trust');
    expect(d?.score).toBe(6);
  });

  it('「不卖课」照旧认', () => {
    const acts = actsOf({ hook: '先说清楚，我不卖课。', synthesis: '我赚了两万。' });
    expect(dim(acts, 'trust')?.score).toBe(6);
  });
});
