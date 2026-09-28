import { describe, expect, it } from 'vitest';
import { findCopied } from '@/lib/benchmark/copy-check';

const ref = '很多人对AI的印象还停留在聊天写代码的线上工具，但其实它早就已经悄悄走进了我们的生活';

describe('findCopied', () => {
  it('finds a run of 12+ identical characters, ignoring punctuation', () => {
    expect(findCopied('说实话，很多人对 AI 的印象还停留在聊天写代码！我不这么看', ref)).toEqual(['很多人对AI的印象还停留在聊天写代码']);
  });
  it('ignores short overlaps', () => {
    expect(findCopied('很多人对AI的印象不太好', ref)).toEqual([]);
  });
  it('returns nothing without a reference', () => {
    expect(findCopied('任何文字任何文字任何文字任何文字', '')).toEqual([]);
  });
});
