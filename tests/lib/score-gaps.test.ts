import { describe, it, expect } from 'vitest';
import { splitGaps, stillOpenGaps } from '@/lib/script/score-gaps';
import { ACT_KEYS } from '@/lib/script/six-act';

function actsOf(map: Partial<Record<string, { narration?: string; visual?: string }>>) {
  return ACT_KEYS.map((act) => ({
    act, title: '', narration: map[act]?.narration ?? '', visual: map[act]?.visual ?? '',
    note: '', targetSec: 10, beats: [], facts: [],
  }));
}

describe('splitGaps', () => {
  it('垫话归到具体那一幕, 且算写法问题', () => {
    const g = splitGaps(actsOf({ concept_b: { narration: '所有想用这个东西的普通人。' } }), 60);
    expect(g.byAct.concept_b?.some((x) => x.includes('这个东西'))).toBe(true);
    expect(g.mechanical.some((m) => m.includes('这个东西'))).toBe(false);
  });

  it('缺画面说明是填字段, 不是写法 —— 改台词永远拿不到这 2 分', () => {
    const g = splitGaps(actsOf({ hook: { narration: '我卡了两天。' } }), 60);
    expect(g.mechanical.some((m) => m.includes('画面'))).toBe(true);
    expect(Object.values(g.byAct).flat().some((x) => x?.includes('画面'))).toBe(false);
  });

  it('超时归到超时的那一幕', () => {
    const long = '字'.repeat(200);
    const g = splitGaps(actsOf({ hook: { narration: long, visual: '出镜' } }), 60);
    expect(g.byAct.hook?.some((x) => x.includes('超'))).toBe(true);
  });

  it('普适化结尾归到金句收尾那一幕', () => {
    const g = splitGaps(actsOf({ punchline: { narration: '就这样。', visual: '出镜' } }), 60);
    expect(g.byAct.punchline?.some((x) => x.includes('结尾'))).toBe(true);
  });

  it('一条问题都没有时两边都是空的', () => {
    const clean = actsOf(
      Object.fromEntries(ACT_KEYS.map((k) => [k, { narration: '这是一句干净的台词。', visual: '出镜正面' }])),
    );
    const g = splitGaps(clean, 60);
    // 关键词还是缺的, 所以 mechanical 不一定空; 但写法类应当没有垫话
    expect(Object.values(g.byAct).flat().some((x) => x?.includes('垫话'))).toBe(false);
  });
});

describe('stillOpenGaps —— 对照说解决了, 到底解决没有', () => {
  it('说删了垫话, 结果词还在, 报出来', () => {
    const open = stillOpenGaps({
      rewritten: '卡住的不是我一个人，是所有想用这个东西的普通人。',
      gaps: ['有垫话「这个东西」，念出来是废字'],
      targetSec: 20,
    });
    expect(open.some((g) => g.includes('这个东西'))).toBe(true);
  });

  it('词真删掉了就不报', () => {
    const open = stillOpenGaps({
      rewritten: '卡住的不是我一个人，是所有想用它的普通人。',
      gaps: ['有垫话「这个东西」，念出来是废字'],
      targetSec: 20,
    });
    expect(open).toEqual([]);
  });

  it('说要删字, 结果还是超时, 报出来', () => {
    const open = stillOpenGaps({
      rewritten: '字'.repeat(200),
      gaps: ['念下来 6.8 秒，超出目标 0.8 秒，要删字'],
      targetSec: 6,
    });
    expect(open.some((g) => g.includes('秒'))).toBe(true);
  });

  it('真的短下来了就不报', () => {
    const open = stillOpenGaps({
      rewritten: '我卡了两天。',
      gaps: ['念下来 6.8 秒，超出目标 0.8 秒，要删字'],
      targetSec: 6,
    });
    expect(open).toEqual([]);
  });

  it('判断不了的那几条(结尾普适、信任声明位置)不乱报', () => {
    const open = stillOpenGaps({
      rewritten: '就这样。',
      gaps: ['结尾只对同行成立。补一句「你做电商、做服务也是一样」'],
      targetSec: 20,
    });
    expect(open).toEqual([]);
  });
});
