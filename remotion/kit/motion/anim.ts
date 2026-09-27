import type React from 'react';
import {interpolate, Easing} from 'remotion';

/**
 * 动效的「时间 → 样式」纯函数(三十二期)。
 *
 * **为什么不直接用 `components.tsx` 里的组件**: 那些组件(FlowerWord/SmashWord/
 * HighlightSweep/NumberRoll…)全是绝对定位——`x`/`y` 是必填 props, 与卡片的
 * 栅格 + flex 布局冲突。二十五期写 Stat 卡时撞过一次, 当时的处理是手抄手法、
 * 不用组件(见 Stat.tsx 注释)。四张卡都接动效不能抄四遍, 所以把「时间→样式」
 * 抽成纯函数, 位置仍归 flex。
 *
 * 手法出处(video-talkcraft, 已获书面商用授权, 标注体例见 motion/README.md):
 * - smashIn ← `components.tsx` 的 `SmashWord`(过冲砸落)
 * - fadeUp ← `components.tsx` 的 `FlowerWord`(进场)
 * - beatHit ← `components.tsx` 的 `BeatHit`
 * - sweepHighlight ← `components.tsx` 的 `HighlightSweep`(背景条扫过)
 * - drawLine ← `components.tsx` 的 `DrawPath`(描画)
 * slideIn/staggerIn 是本项目新写(原库没有对应组件)。
 *
 * 纯函数的收益: 可单测。本项目其它判据(freeze-check/still-check/时间轴校验)
 * 都是这个路子——能单测的东西才有人在改动后发现它坏了。
 */

/** 归一化进度: at 之前恒 0, 持续 dur 秒线性推进到 1, 之后恒 1。 */
const prog = (frame: number, fps: number, atSec: number, durSec: number): number =>
  interpolate(frame, [atSec * fps, (atSec + durSec) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

/**
 * 数字转字符串时清掉多余的小数尾零(如 `1.000` -> `1`, `0.0` -> `0`)。
 *
 * 踩坑记录: `toFixed(n)` 返回的是字符串, `(1).toFixed(3)` 是 `'1.000'` 而不是
 * `'1'`。这个尾零会原样进 `transform`/`clipPath` 字符串, 拼进 DOM。数值上等价,
 * 但「动效结束后精确归位」是这个模块要保证的语义, 值得让归位后的字符串本身
 * 干净——所以在这里统一清尾零, 而不是让测试改成数值解析再比较。
 * 做法: 用 `toFixed` 先按目标精度四舍五入(避免浮点误差产生的长尾), 再喂给
 * `Number()` 还原成数字(自动丢弃尾零), 最后转回字符串。
 */
const clean = (n: number, digits: number): string => String(Number(n.toFixed(digits)));

export const smashIn = (frame: number, fps: number, atSec: number): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.42);
  const e = Easing.out(Easing.back(1.8))(p);
  /*
   * 本项目修改: 源组件 SmashWord 的 opacity 是 `clamp(p*3, 0, 1)` —— 前 1/3
   * 时长内淡入完毕、随后恒为 1。**这个"提前完成"是手法的一部分, 不是随手写的**:
   * 文字先快速可见(砸的冲击), 缩放/位移随后由 back-out 继续过冲回弹(落的物理感),
   * 两者刻意错峰。把 opacity 拉成全程线性会把错峰抹平, 手感退化成普通的"缩放淡入"
   * (三十二期 Task 1 复审对照原组件指出的)。
   *
   * 但原样照搬 p*3 有个纯函数化带来的问题: opacity 在 p>0.33 后恒为 1,
   * "进行中"与"结束后"在断言里不可区分, 三态覆盖立不住。
   *
   * 折中: 保留"提前完成"的错峰设计, 只把完成阈值从 1/3 放宽到 0.55 ——
   * 冲击感仍在(opacity 在动效前半程就基本到位、领先于回弹), 同时中段可辨。
   */
  return {
    opacity: interpolate(p, [0, 0.55], [0, 1], {extrapolateRight: 'clamp'}),
    transform: `scale(${clean(1 + (1 - e) * 0.35, 3)}) translateY(${clean((1 - e) * -22, 1)}px)`,
  };
};

export const fadeUp = (frame: number, fps: number, atSec: number): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.5);
  const e = Easing.out(Easing.cubic)(p);
  return {opacity: e, transform: `translateY(${clean((1 - e) * 18, 1)}px)`};
};

export const beatHit = (frame: number, fps: number, atSec: number): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.3);
  // 三角波: 0→1→0, 峰值在中点
  const wave = p < 0.5 ? p * 2 : (1 - p) * 2;
  return {transform: `scale(${clean(1 + wave * 0.12, 3)})`};
};

export const slideIn = (
  frame: number, fps: number, atSec: number, dir: 'left' | 'right',
): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.5);
  const e = Easing.out(Easing.cubic)(p);
  const from = dir === 'left' ? -60 : 60;
  return {opacity: e, transform: `translateX(${clean((1 - e) * from, 1)}px)`};
};

export const staggerIn = (
  frame: number, fps: number, atSec: number, index: number, gapSec = 0.12,
): React.CSSProperties => fadeUp(frame, fps, atSec + index * gapSec);

export const sweepHighlight = (frame: number, fps: number, atSec: number): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.45);
  return {backgroundSize: `${Math.round(p * 100)}% 100%`};
};

export const drawLine = (frame: number, fps: number, atSec: number): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.5);
  return {clipPath: `inset(0 ${Math.round((1 - p) * 100)}% 0 0)`};
};

/**
 * 环形进度描画(三十三期)。
 *
 * 手法: SVG `stroke-dasharray` = 周长、`stroke-dashoffset` 从周长收到
 * `周长×(1-ratio)` —— 未开始时整圈都是"空隙"(看不见), 画完时露出 ratio 那一段。
 * 与 overlay-studio 的 RingMetric 同一手法, 但它靠 CSS transition 走 1100ms、
 * 环心数字另用 JS 计时器走 1100ms(两套时钟手动对齐); 我们两者都由 frame 驱动,
 * 天然同步, 不需要对齐。
 */
export const ringDraw = (
  frame: number, fps: number, atSec: number, ratio: number, circumference: number,
): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.9);
  const e = Easing.out(Easing.cubic)(p);
  return {
    strokeDasharray: circumference,
    strokeDashoffset: circumference * (1 - ratio * e),
  };
};

/**
 * 曲线描画的归一化进度(三十三期)。
 *
 * 返回 0→1 的裸进度而不是样式对象 —— 曲线卡要用同一个进度值同时驱动三件事
 * (描画长度、面积透明度、数据点逐个亮起), 返回样式就没法复用。配合 SVG 的
 * `pathLength={1}` 使用: 把路径长度归一化成 1 之后, "画了多长"直接就是这个进度值,
 * 与真实像素长度解耦(overlay-studio 的 GrowthCurve 用的就是这个技巧)。
 */
export const curveDraw = (frame: number, fps: number, atSec: number, durSec: number): number =>
  prog(frame, fps, atSec, durSec);

/** 条形从左生长到 ratio(三十三期)。`transformOrigin: left` 让它从左端长出而不是中间撑开。 */
export const barGrow = (
  frame: number, fps: number, atSec: number, ratio: number,
): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.9);
  const e = Easing.out(Easing.cubic)(p);
  return {transform: `scaleX(${clean(ratio * e, 3)})`, transformOrigin: 'left center'};
};

/**
 * 从 0 数到 target(三十三期)。
 *
 * 结束后**精确等于** target, 不做取整 —— 非整数值(如 facts 台账里的 32.2%)
 * 取整会与台账不再逐位一致, 这是 Stat 卡二十九期定下的约定(见 lib.tsx 的
 * roundToSourceDecimals)。显示时的取整精度由调用方按 target 自身的小数位决定。
 */
export const countTo = (
  frame: number, fps: number, atSec: number, target: number, durSec: number,
): number => {
  const p = prog(frame, fps, atSec, durSec);
  const e = Easing.out(Easing.cubic)(p);
  return target * e;
};
