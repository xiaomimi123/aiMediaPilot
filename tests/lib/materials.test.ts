import { describe, it, expect } from 'vitest';
import {
  MATERIAL_KINDS,
  MATERIAL_LABELS,
  isMaterialKind,
  matchMaterials,
  materialGaps,
} from '@/lib/materials/model';

const M = (id: string, kind: string, content: string, tags: string[] = []) => ({
  id, kind, content, source: '', tags,
});

describe('素材类型', () => {
  it('五类: 书摘 / 数据 / 故事 / 金句 / 亲身经历', () => {
    expect(MATERIAL_KINDS).toHaveLength(5);
    expect(MATERIAL_KINDS.map((k) => MATERIAL_LABELS[k])).toEqual([
      '书摘', '数据', '故事', '金句', '亲身经历',
    ]);
  });

  it('不认识的类型挡在门外, 不悄悄存进库', () => {
    expect(isMaterialKind('quote')).toBe(true);
    expect(isMaterialKind('meme')).toBe(false);
  });
});

describe('matchMaterials —— 按当前幕检索', () => {
  const materials = [
    M('1', 'quote', '《影响力》里说互惠原理让人难以拒绝', ['影响力', '互惠']),
    M('2', 'data', '试吃可以让该品类购买率提升 5 倍', ['试吃', '购买率']),
    M('3', 'experience', '我在超市被试吃摊拦下，最后买了一整排酸奶', ['超市', '试吃']),
    M('4', 'punchline', '免费的东西最贵', []),
  ];

  it('关键词命中 tags', () => {
    const hits = matchMaterials(materials, { narration: '', beats: ['试吃'] });
    expect(hits.map((m) => m.id)).toContain('2');
    expect(hits.map((m) => m.id)).toContain('3');
  });

  it('关键词命中正文, 不只看 tags —— tags 常常是懒得填的', () => {
    const hits = matchMaterials(materials, { narration: '互惠原理是怎么起作用的', beats: [] });
    expect(hits.map((m) => m.id)).toContain('1');
  });

  it('命中越多排越前', () => {
    const hits = matchMaterials(materials, { narration: '超市试吃', beats: ['试吃'] });
    expect(hits[0].id).toBe('3'); // 超市 + 试吃 两处命中
  });

  it('什么都没命中时返回空数组, 不硬塞几条充数', () => {
    expect(matchMaterials(materials, { narration: '量子力学', beats: [] })).toEqual([]);
  });

  it('单字不算关键词 —— 「的」「了」会把整个库都捞出来', () => {
    expect(matchMaterials(materials, { narration: '的了是在', beats: [] })).toEqual([]);
  });

  it('空素材库不报错', () => {
    expect(matchMaterials([], { narration: '试吃', beats: [] })).toEqual([]);
  });
});

describe('materialGaps —— 哪一类最缺', () => {
  it('按数量升序报缺口, 亲身经历为空时排第一', () => {
    const gaps = materialGaps([
      M('1', 'quote', 'a'), M('2', 'quote', 'b'), M('3', 'data', 'c'),
    ]);
    expect(gaps[0].kind).toBe('experience');
    expect(gaps[0].count).toBe(0);
  });

  it('亲身经历的提示单独说明它不可替代 —— 其余四类 AI 也能查', () => {
    const gaps = materialGaps([]);
    const exp = gaps.find((g) => g.kind === 'experience')!;
    expect(exp.why).toContain('只有你自己');
  });

  it('五类都有货时也照样返回五条 —— 用来展示分布, 不是只报警', () => {
    const all = MATERIAL_KINDS.map((k, i) => M(String(i), k, 'x'));
    expect(materialGaps(all)).toHaveLength(5);
  });
});
