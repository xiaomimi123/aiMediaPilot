import { describe, it, expect } from 'vitest';
import { isSixActDraft, isSixActScript, ACT_KEYS } from '@/lib/script/six-act';

const act = (act: string, narration: string, beats = 3) => ({
  act, title: 't', narration, visual: '', note: '',
  targetSec: 10,
  beats: Array.from({ length: beats }, (_, i) => ({ keyword: `k${i}` })),
  facts: [],
});
const dims = { gain: 'a', surprise: 'b', clarity: 'c', appeal: 'd' };
const written = ACT_KEYS.map((k) => act(k, '这是一段已经写好的台词'));
const blank = ACT_KEYS.map((k) => act(k, '', 0));

describe('isSixActDraft —— 判别的是「是不是六幕」, 不是「写没写」', () => {
  it('**台词全空的骨架仍然是六幕稿**', () => {
    expect(isSixActDraft({ acts: blank })).toBe(true);
  });

  it('没有 four_dims 也是六幕稿 —— 那是对成稿的评价, 不是结构的一部分', () => {
    expect(isSixActDraft({ acts: written })).toBe(true);
  });

  it('关键词一个都没有也不影响结构判别', () => {
    expect(isSixActDraft({ acts: ACT_KEYS.map((k) => act(k, '写了台词', 0)) })).toBe(true);
  });

  it('少一幕就不是六幕稿 —— 结构本身仍然严格', () => {
    expect(isSixActDraft({ acts: blank.slice(0, 5) })).toBe(false);
  });

  it('顺序错了也不是 —— 六幕是有序的', () => {
    const swapped = [blank[1], blank[0], ...blank.slice(2)];
    expect(isSixActDraft({ acts: swapped })).toBe(false);
  });

  it('旧的 sections 结构不会被误判成六幕', () => {
    expect(isSixActDraft({ sections: [{ role: 'hook', text: 'x' }] })).toBe(false);
  });
});

describe('isSixActScript 保持严格 —— 它把关的是 AI 交上来的成稿', () => {
  it('空台词的骨架不算合格成稿', () => {
    expect(isSixActScript({ acts: blank, four_dims: dims })).toBe(false);
  });

  it('写满且带 four_dims 才算', () => {
    expect(isSixActScript({ acts: written, four_dims: dims })).toBe(true);
  });
});
