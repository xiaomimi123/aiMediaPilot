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

import { readActsFromDraftOutput } from '@/lib/cockpit/script-score';

describe('readActsFromDraftOutput —— 骨架稿也要读得出来', () => {
  const output = (narration: string) => ({
    script: {
      acts: ACT_KEYS.map((act) => ({ act, title: 't', narration, visual: '', targetSec: 10 })),
    },
  });

  it('**台词全空的骨架稿读得出六幕** —— 读不出就会被稿库标成「非六幕」', () => {
    expect(readActsFromDraftOutput(output(''))).toHaveLength(6);
  });

  it('写好的稿子照常读出来', () => {
    expect(readActsFromDraftOutput(output('写好的台词'))).toHaveLength(6);
  });

  it('act 字段缺失才算读不出 —— 那才是真的结构不对', () => {
    expect(readActsFromDraftOutput({ script: { acts: [{ narration: 'x' }] } })).toBeNull();
  });

  it('根本没有 acts 的旧稿仍然返回 null', () => {
    expect(readActsFromDraftOutput({ script: { sections: [] } })).toBeNull();
  });
});
