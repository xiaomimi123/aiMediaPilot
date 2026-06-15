import { describe, expect, it } from 'vitest';
import { bigramDice, filenameBasename } from '@/lib/douyin/fuzzy';

describe('bigramDice', () => {
  it('相同字符串 → 1.0', () => {
    expect(bigramDice('hello world', 'hello world')).toBe(1);
  });
  it('完全不同 → 0.0', () => {
    expect(bigramDice('abcdef', 'xyzwvu')).toBe(0);
  });
  it('一边空 → 0.0', () => {
    expect(bigramDice('', 'something')).toBe(0);
    expect(bigramDice('something', '')).toBe(0);
  });
  it('单字符 → 0.0 (无法形成 bigram)', () => {
    expect(bigramDice('a', 'a')).toBe(0);
  });
  it('部分重叠中文 → 介于 0.5-0.9', () => {
    const score = bigramDice('ChatGPT 5 个隐藏技巧', 'ChatGPT 5 个不知道的技巧');
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(0.9);
  });
  it('大小写不敏感', () => {
    expect(bigramDice('ChatGPT', 'chatgpt')).toBe(1);
  });
});

describe('filenameBasename', () => {
  it('去 .mp4 后缀', () => {
    expect(filenameBasename('mock-1.mp4')).toBe('mock-1');
  });
  it('去 .MOV 后缀', () => {
    expect(filenameBasename('video.MOV')).toBe('video');
  });
  it('无后缀保持原样', () => {
    expect(filenameBasename('plainfile')).toBe('plainfile');
  });
  it('多 dot 只去最后', () => {
    expect(filenameBasename('my.test.video.mp4')).toBe('my.test.video');
  });
});
