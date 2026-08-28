/**
 * 图表几何(二十三期)。
 *
 * 手写 SVG 不引图表库: 这里要画的就是柱状和散点两种, 一个 500KB 的依赖换两个
 * 循环不划算; 而且自己算刻度才能保证**不撒谎** —— 现成库默认会做的那些事
 * (从非零起点画柱、自动补齐缺失点)在这个项目里都是不能接受的。
 */

export interface Bar {
  label: string;
  value: number;
  /** 0~1, 相对最大值的高度。最大值为 0 时全是 0, 不是 NaN。 */
  ratio: number;
  highlight: boolean;
}

/**
 * 柱状图。**基线永远是 0** —— 从非零起点画柱会把 4985 和 5010 画成天壤之别。
 *
 * `highlightAbove` 用来标出高于中位数的那几条: 看分布时真正有信息的是「哪几条
 * 冒出来了」, 而不是每根柱子的绝对高度。
 */
export function buildBars(
  rows: { label: string; value: number }[],
  highlightAbove = 0,
): Bar[] {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return rows.map((r) => ({
    label: r.label,
    value: r.value,
    ratio: max > 0 ? r.value / max : 0,
    highlight: highlightAbove > 0 && r.value > highlightAbove,
  }));
}

export interface ScatterPoint {
  /** 0~1 的绘图坐标, 左下为原点。 */
  x: number;
  y: number;
  label: string;
  rawX: number;
  rawY: number;
}

/**
 * 散点。x/y 各自归一化到 0~1。
 *
 * **只有一个点时放在正中**而不是角落: 一个点画在 (0,0) 看起来像「表现最差」,
 * 而实际上它只是唯一的样本, 没有可比对象。
 */
export function buildScatter(
  rows: { label: string; x: number; y: number }[],
): ScatterPoint[] {
  if (rows.length === 0) return [];
  const xs = rows.map((r) => r.x);
  const ys = rows.map((r) => r.y);
  const norm = (v: number, arr: number[]): number => {
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    if (max === min) return 0.5;
    return (v - min) / (max - min);
  };
  return rows.map((r) => ({
    x: norm(r.x, xs),
    y: norm(r.y, ys),
    label: r.label,
    rawX: r.x,
    rawY: r.y,
  }));
}

/** 百分比展示。抖音给的是 0~1 的小数, 界面上一律显示成百分比。 */
export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

/** 大数字缩写: 224296 → 22.4万。中文语境下「万」比 224.3K 好读得多。 */
export function humanCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString();
}
