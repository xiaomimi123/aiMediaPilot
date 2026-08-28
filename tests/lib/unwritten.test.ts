import { describe, it, expect } from 'vitest';
import { isUnwritten } from '@/lib/cockpit/script-score';
import { ACT_KEYS } from '@/lib/script/six-act';

const mk = (n: (k: string) => string) =>
  ACT_KEYS.map((k) => ({ act: k, title: '', narration: n(k), visual: '', note: '这一幕该干什么', targetSec: 10, beats: [], facts: [] }));

describe('isUnwritten —— 还没写的稿子不该被打分', () => {
  it('**六幕全空 = 还没开始写**', () => {
    expect(isUnwritten(mk(() => ''))).toBe(true);
  });

  it('只有空格和标点也算没写', () => {
    expect(isUnwritten(mk(() => ' ，。 '))).toBe(true);
  });

  it('写了一幕就不算没写 —— 从第一个字开始就该给反馈', () => {
    expect(isUnwritten(mk((k) => (k === 'hook' ? '你有没有过这种时候' : '')))).toBe(false);
  });

  it('骨架的备注不算正文 —— 那是给你的指令, 不是你的话', () => {
    expect(isUnwritten(mk(() => ''))).toBe(true);
  });
});
