import { describe, it, expect } from 'vitest';
import { rewriteRatio, compareToBaseline, UNTOUCHED_THRESHOLD } from '@/lib/script/rewrite-diff';

const act = (a: string, narration: string) => ({
  act: a, title: a, narration, visual: '', note: '', targetSec: 10, beats: [], facts: [],
});

describe('rewriteRatio', () => {
  it('一个字没改 = 0', () => {
    expect(rewriteRatio('今天讲一件事', '今天讲一件事')).toBe(0);
  });

  it('完全重写 = 1', () => {
    expect(rewriteRatio('今天讲一件事', '你有没有过这种时候')).toBeCloseTo(1, 1);
  });

  it('改一半大约 0.5 上下', () => {
    const r = rewriteRatio('我昨天去了超市买东西', '我昨天去了菜市场逛了逛');
    expect(r).toBeGreaterThan(0.2);
    expect(r).toBeLessThan(0.8);
  });

  it('只加了几个字 → 比例低, 但不是 0', () => {
    const r = rewriteRatio('今天讲一件事', '今天讲一件事，很短');
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.35);
  });

  it('原文为空时, 有内容就算全新写的', () => {
    expect(rewriteRatio('', '我写了一段')).toBe(1);
  });

  it('两边都空 = 0, 不除零', () => {
    expect(rewriteRatio('', '')).toBe(0);
  });

  it('标点不算改写 —— 改个逗号不叫用自己的话重写', () => {
    expect(rewriteRatio('今天讲一件事，很短', '今天讲一件事。很短')).toBe(0);
  });
});

describe('compareToBaseline', () => {
  const baseline = [act('hook', 'AI 时代已经到来，我们必须拥抱变化'), act('punchline', '这就是我的思考')];

  it('逐幕给出改写度', () => {
    const current = [act('hook', '你有没有发现，装个软件比登天还难'), act('punchline', '这就是我的思考')];
    const r = compareToBaseline(current, baseline)!;
    expect(r.acts.find((a) => a.act === 'hook')!.rewriteRatio).toBeGreaterThan(0.5);
    expect(r.acts.find((a) => a.act === 'punchline')!.rewriteRatio).toBe(0);
  });

  it('**点名一个字没改的幕** —— AI 的表达会原样留在成片里', () => {
    const current = [act('hook', '你有没有发现，装个软件比登天还难'), act('punchline', '这就是我的思考')];
    const r = compareToBaseline(current, baseline)!;
    expect(r.untouched.map((a) => a.act)).toEqual(['punchline']);
  });

  it('整体改写度按字数加权 —— 长幕没改比短幕没改严重', () => {
    const bl = [act('hook', '短'), act('punchline', '这是一段很长很长的台词'.repeat(3))];
    const cur = [act('hook', '改了'), act('punchline', '这是一段很长很长的台词'.repeat(3))];
    const r = compareToBaseline(cur, bl)!;
    expect(r.overallRatio).toBeLessThan(0.3);
  });

  it('全部重写 → overallRatio 接近 1', () => {
    const cur = [act('hook', '完全不一样的开头写法'), act('punchline', '完全不一样的收尾写法')];
    expect(compareToBaseline(cur, baseline)!.overallRatio).toBeGreaterThan(0.8);
  });

  it('没有基线时返回 null —— 不假装能比较', () => {
    expect(compareToBaseline([act('hook', 'x')], null)).toBeNull();
  });

  it('基线里没有的幕不报改写度, 但也不当成未改', () => {
    const cur = [...baseline.map((b) => ({ ...b })), act('trivia', '新加的一幕')];
    const r = compareToBaseline(cur, baseline);
    expect(r!.acts.find((a) => a.act === 'trivia')).toBeUndefined();
    expect(r!.untouched.map((a) => a.act)).toEqual(['hook', 'punchline']);
  });

  it(`未改写的判定阈值是导出的常量 ${UNTOUCHED_THRESHOLD}`, () => {
    expect(UNTOUCHED_THRESHOLD).toBeGreaterThan(0);
    expect(UNTOUCHED_THRESHOLD).toBeLessThan(0.2);
  });
});
