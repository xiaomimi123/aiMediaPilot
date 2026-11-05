import { describe, expect, it } from 'vitest';
import { findFlavorInScript, findFlavorInText, flavorSummary } from '@/lib/script/flavor-check';
import type { Script } from '@/lib/script/model';

const seg = (text: string): Script => ({ segments: [{ id: 's1', role: 'hook', text }] });

describe('findFlavorInText 词级规则', () => {
  it('命中书面热词', () => {
    const hits = findFlavorInText('它为整个团队赋能。');
    expect(hits.map((h) => h.kind)).toContain('ai-word');
    expect(hits[0].text).toBe('赋能');
  });

  it('命中犹豫词与套话垫场', () => {
    const hits = findFlavorInText('说实话，总而言之它挺好。');
    expect(hits.map((h) => h.kind)).toEqual(['hedge', 'filler']);
  });

  it('命中空泛金句', () => {
    expect(findFlavorInText('它值得我们深思。').map((h) => h.kind)).toEqual(['grand']);
    expect(findFlavorInText('它会改变我们的生活方式。').map((h) => h.kind)).toEqual(['grand']);
  });

  it('正常口播句不误报', () => {
    expect(findFlavorInText('我把这个工具装在了公司那台 2019 年的旧本上。')).toEqual([]);
    expect(findFlavorInText('库存表刷出来那一下，我是真懵了。')).toEqual([]);
    expect(findFlavorInText('它确实改变了很多。')).toEqual([]);
  });

  it('「不是…而是…」整句命中', () => {
    const hits = findFlavorInText('它不是让你少干活，而是让你把时间花在刀刃上。');
    expect(hits.map((h) => h.kind)).toEqual(['contrast']);
  });

  it('不是 AI 句式的「不是」不命中', () => {
    expect(findFlavorInText('那天我用的不是新版本，是旧版，结果跑通了。')).toEqual([]);
  });
});

describe('findFlavorInScript', () => {
  it('逐段标明段落名', () => {
    const script: Script = {
      segments: [
        { id: 's1', role: 'hook', text: '它为团队赋能。' },
        { id: 's2', role: 'close', text: '库存表刷出来那一下我懵了。' },
      ],
    };
    const hits = findFlavorInScript(script);
    expect(hits).toHaveLength(1);
    expect(hits[0].segment).toBe('钩子');
    expect(hits[0].segmentId).toBe('s1');
  });

  it('干净稿子返回空数组', () => {
    expect(findFlavorInScript(seg('我把工具装在旧本上，第三秒跑通了。'))).toEqual([]);
  });
});

describe('flavorSummary', () => {
  it('无命中返回空串', () => {
    expect(flavorSummary([])).toBe('');
  });

  it('按段落计数', () => {
    const hits = findFlavorInScript({
      segments: [
        { id: 's1', role: 'hook', text: '它为团队赋能。' },
        { id: 's2', role: 'fact', text: '说实话它有底层逻辑。' },
      ],
    });
    expect(flavorSummary(hits)).toContain('「钩子」有 1 处');
    expect(flavorSummary(hits)).toContain('「怎么做的」有 2 处');
  });
});
