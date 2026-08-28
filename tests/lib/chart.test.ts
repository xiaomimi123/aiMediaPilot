import { describe, it, expect } from 'vitest';
import { buildBars, buildScatter, pct, humanCount } from '@/lib/works/chart';

describe('buildBars', () => {
  it('比例相对最大值', () => {
    const b = buildBars([{ label: 'a', value: 50 }, { label: 'b', value: 100 }]);
    expect(b[0].ratio).toBe(0.5);
    expect(b[1].ratio).toBe(1);
  });

  it('**全是 0 时不除零** —— ratio 是 0 不是 NaN', () => {
    const b = buildBars([{ label: 'a', value: 0 }, { label: 'b', value: 0 }]);
    expect(b.every((x) => x.ratio === 0)).toBe(true);
  });

  it('高于阈值的标出来 —— 看分布时有信息的是「哪几条冒出来了」', () => {
    const b = buildBars([{ label: 'a', value: 10 }, { label: 'b', value: 100 }], 50);
    expect(b.map((x) => x.highlight)).toEqual([false, true]);
  });

  it('阈值为 0 时不标任何一条 —— 否则每条都算「高于 0」', () => {
    const b = buildBars([{ label: 'a', value: 10 }], 0);
    expect(b[0].highlight).toBe(false);
  });

  it('空输入返回空数组, 不抛', () => {
    expect(buildBars([])).toEqual([]);
  });
});

describe('buildScatter', () => {
  it('两端归一化到 0 和 1', () => {
    const p = buildScatter([
      { label: 'a', x: 10, y: 1 },
      { label: 'b', x: 20, y: 3 },
    ]);
    expect(p[0].x).toBe(0);
    expect(p[1].x).toBe(1);
  });

  it('**只有一个点时放正中** —— 画在角落看起来像「最差」, 而它只是唯一样本', () => {
    const p = buildScatter([{ label: 'a', x: 5, y: 5 }]);
    expect(p[0].x).toBe(0.5);
    expect(p[0].y).toBe(0.5);
  });

  it('所有点同值时也放正中, 不除零', () => {
    const p = buildScatter([{ label: 'a', x: 5, y: 1 }, { label: 'b', x: 5, y: 1 }]);
    expect(p.every((q) => q.x === 0.5 && q.y === 0.5)).toBe(true);
  });

  it('保留原值 —— 悬浮要显示真实数字而不是归一化后的', () => {
    const p = buildScatter([{ label: 'a', x: 4985, y: 0.326 }]);
    expect(p[0].rawX).toBe(4985);
    expect(p[0].rawY).toBe(0.326);
  });

  it('空输入返回空数组', () => {
    expect(buildScatter([])).toEqual([]);
  });
});

describe('pct / humanCount', () => {
  it('小数转百分比', () => {
    expect(pct(0.3263801474554936)).toBe('32.6%');
  });

  it('**没有数据显示破折号, 不显示 0%** —— 那是两件完全不同的事', () => {
    expect(pct(null)).toBe('—');
    expect(pct(undefined)).toBe('—');
    expect(pct(0)).toBe('0.0%');
  });

  it('大数字用「万」', () => {
    expect(humanCount(224296)).toBe('22.4万');
    expect(humanCount(4985)).toBe('4,985');
  });
});
