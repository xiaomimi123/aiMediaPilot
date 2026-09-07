import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_CN, roundToSourceDecimals, clamp} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';
import {CardTheme} from '../theme';
import {fadeUp, curveDraw, countTo} from '../motion/anim';
import {resolveAccent, scaleStyle, speedT, ShotStyle} from './style';

/** SVG viewBox 归一化尺寸——用 preserveAspectRatio="none" 拉伸铺满容器,
 * 数值本身不重要, 只要横纵比统一, 详见下方组件注释里"为什么可以拉伸"。 */
const VIEW_W = 100;
const VIEW_H = 60;
/** 曲线的纵向留白(viewBox 单位), 给最高/最低点的圆点半径和描边留出空间,
 * 否则贴边的点会被 svg 裁掉一半。 */
const PAD_Y = 10;

/**
 * Catmull-Rom 样条 → 三次贝塞尔(uniform, tension=0, 即张力系数 1/6)。
 *
 * 出处: 这是图形学里的标准转换公式(非 video-talkcraft 搬运——那份库没有曲线卡
 * 的对应组件), 推导见 Catmull & Rom 1974 论文与后续通用整理: 每一段
 * `[P1,P2]` 的贝塞尔控制点取
 *   `C1 = P1 + (P2 - P0) / 6`
 *   `C2 = P2 - (P3 - P1) / 6`
 * 端点缺相邻点时用首/尾点自身"补一个虚拟点"(clamp 边界, 而不是首尾相接成环),
 * 因为这是一条随时间推进的折线图, 不是闭合曲线。
 *
 * 效果: 曲线过每一个数据点(插值样条, 不是贝塞尔逼近), 相邻两点间的切线方向
 * 由左右邻居共同决定, 视觉上比"折线直接连"平滑, 比"每段独立贝塞尔"更连续
 * (一阶导数在数据点处连续)。
 */
function catmullRomToBezierPath(points: Array<{x: number; y: number}>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  // 首尾各补一个"虚拟点"(直接复用端点自身)作为 P0/P3, 让首尾两段也能套用
  // 同一条通用公式, 不必对首尾特判。
  const padded = [points[0], ...points, points[points.length - 1]];
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < padded.length - 2; i++) {
    const p0 = padded[i - 1];
    const p1 = padded[i];
    const p2 = padded[i + 1];
    const p3 = padded[i + 2];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * 增长曲线卡：顶部 label + 峰值数字, 下方一条随时间描画出来的曲线, 每个数据点
 * 逐个亮起, 带渐变面积。
 *
 * 骨架同源 Ring/Entity: safeBox 定位、scaleFont 定字号、assertContent 校验必填、
 * 颜色一律读 theme。
 *
 * 版面不用绝对坐标: 数据点在 x 轴上均匀分布, 上方"数值"标注行和下方"时间"
 * 标注行都用 `display:flex, justifyContent:'space-between'` 排布——这与 SVG
 * viewBox 的 `preserveAspectRatio="none"` 拉伸铺满同一个容器宽度, 两者的第
 * 一项都贴容器左边、最后一项都贴容器右边、中间项等距——天然对齐到 SVG 里同一
 * 组 x 坐标, 不需要算任何像素偏移。
 *
 * `preserveAspectRatio="none"` 为什么可以拉伸而不失真: 这是一张风格化的统计
 * 图表, 不是要保真的几何图形(不像 Ring 的圆环, 拉伸会让圆变成蛋形从而破坏
 * "圆环"这个符号本身)——折线图的横纵比本来就取决于容器尺寸, 拉伸铺满是折线图
 * 的常规做法。
 *
 * 一个进度值串三件事(spec §2.3, 也是任务书原话)——`draw = curveDraw(...)`:
 * - 曲线本身: `pathLength={1}` 把路径长度归一化成 1, `strokeDashoffset={1-draw}`
 *   直接就是"画了多长", 与真实像素长度解耦(注释见 anim.ts 里 curveDraw 的说明)。
 * - 面积: `opacity={draw}`, 曲线画多少面积就淡入多少。
 * - 每个点: `on = clamp((draw - i/(n-1)*0.9) / 0.15, 0, 1)`——点在"画笔画到它
 *   所在的 x 位置前后 0.15 个 draw 单位"这段窗口内完成淡入, `× 0.9` 是留一点
 *   提前量, 让最后一个点能在 draw 走到 1 之前就完成(不必等画笔精确碰到终点)。
 *
 * `curveDraw` 本身是线性无缓动的(与 drawLine/sweepHighlight 同一手法, 见 anim.ts
 * 注释)——这里不额外叠加缓动, `on` 的 clamp 窗口已经让"逐个亮起"有足够的
 * 节奏感, 不需要曲线本身再做加速/减速。
 *
 * 峰值数字比曲线晚收尾(spec §2.3): `countTo` 用 2.3s, 曲线用 2.0s, 两者同一
 * `atSec` 起播——数字比曲线晚 0.3s 停, 是"曲线画完、峰值数字才刚好定格"的
 * 节奏设计, 不是笔误。
 */
export const Curve: React.FC<{
  slots: {label: string; points: Array<{at: string; value: number}>; suffix?: string; note?: string};
  durationInFrames: number;
  theme: CardTheme;
  style?: ShotStyle;
}> = ({slots, theme, style}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);
  const label = assertContent(slots.label, 'curve.label');
  const points = slots.points.map((p, i) => ({
    at: assertContent(p.at, `curve.points[${i}].at`),
    value: p.value,
  }));
  const n = points.length;
  const t = speedT(style);
  const accentColor = resolveAccent(style?.accent, theme, theme.accent);
  const highlightColor = resolveAccent(style?.accent, theme, theme.highlight);

  const peak = Math.max(...points.map((p) => p.value));

  const drawAtSec = t(0.3);
  const draw = curveDraw(frame, fps, drawAtSec, 2.0);
  /*
 * 一个点"亮到什么程度": 画笔画到它所在的位置时才淡入(0.15 的宽度让它渐显而不是啪地出现)。
 * 这个式子原本在下面的三处渲染(数值标注 / 圆点 / 时间标签)里各写了一遍 —— 三处必须
 * 同步变化, 否则数值先亮、圆点后亮, 一眼就穿帮。抽成一个函数, 让"必须一致"这件事
 * 由代码结构保证, 而不是靠三处都记得改。
 */
  const onAt = (i: number) => clamp((draw - (n <= 1 ? 0 : (i / (n - 1)) * 0.9)) / 0.15, 0, 1);
  const drawArriveAt = drawAtSec + 2.0;
  const shownPeak = roundToSourceDecimals(countTo(frame, fps, drawAtSec, peak, 2.3), peak);
  const peakArriveAt = drawAtSec + 2.3;

  const labelFade = fadeUp(frame, fps, t(0));
  const labelArriveAt = t(0) + 0.5;

  // 值域: min/max 相同时(所有点同值)兜底 range=1, 否则曲线会除以 0 变成一条
  // 挤在正中间高度不明的横线——用固定 range 让"所有点相同"退化成一条居中的
  // 平线, 而不是 NaN。
  const values = points.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const valueToY = (v: number) => PAD_Y + (1 - (v - minV) / range) * (VIEW_H - 2 * PAD_Y);

  const xs = points.map((_, i) => (n === 1 ? VIEW_W / 2 : (i / (n - 1)) * VIEW_W));
  const geomPoints = points.map((p, i) => ({x: xs[i], y: valueToY(p.value)}));

  const curvePathD = catmullRomToBezierPath(geomPoints);
  const areaPathD = n > 0
    ? `${curvePathD} L ${xs[n - 1]} ${VIEW_H} L ${xs[0]} ${VIEW_H} Z`
    : '';

  const chartWidth = box.innerWidth;
  const chartHeight = Math.round(box.innerHeight * 0.42);
  const gradientId = `curve-area-${slots.label}`.replace(/[^a-zA-Z0-9_-]/g, '');

  return (
    <AbsoluteFill
      style={{
        padding: `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`,
        justifyContent: 'center',
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...scaleStyle(style),
      }}
    >
      <div style={{display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', width: chartWidth}}>
        <Live
          seed={1}
          from={labelArriveAt}
          style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 34), color: accentColor, letterSpacing: '0.12em', ...labelFade}}
        >
          <span data-slot="label">{label}</span>
        </Live>
        <Live seed={2} from={peakArriveAt} style={{display: 'flex', alignItems: 'baseline'}}>
          <span
            data-slot="peak"
            style={{fontFamily: FONT_CN, fontWeight: 900, color: theme.title, fontSize: scaleFont(width, height, 52)}}
          >
            {shownPeak}{slots.suffix ?? ''}
          </span>
        </Live>
      </div>

      <div style={{display: 'flex', flexDirection: 'column', width: chartWidth, marginTop: scaleFont(width, height, 20)}}>
        {/* 每个点的数值标注(chart 上方), 与下方 SVG 里的点用同一个 i/(n-1) 比例
            分布, 靠 justifyContent:'space-between' 天然对齐, 不需要绝对坐标。 */}
        <div style={{display: 'flex', flexDirection: 'row', justifyContent: 'space-between'}}>
          {points.map((p, i) => {
            const on = onAt(i);
            return (
              <span
                key={i}
                data-slot={`point-${i}-value`}
                style={{
                  fontFamily: FONT_CN, fontWeight: 700, color: highlightColor,
                  fontSize: scaleFont(width, height, 22), opacity: on,
                }}
              >
                {roundToSourceDecimals(p.value, p.value)}{slots.suffix ?? ''}
              </span>
            );
          })}
        </div>

        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          width={chartWidth}
          height={chartHeight}
          style={{overflow: 'visible', marginTop: scaleFont(width, height, 8)}}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={highlightColor} stopOpacity={0.5} />
              <stop offset="100%" stopColor={highlightColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPathD} fill={`url(#${gradientId})`} stroke="none" opacity={draw} />
          <path
            d={curvePathD}
            fill="none"
            stroke={highlightColor}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - draw}
          />
          {geomPoints.map((p, i) => {
            const on = onAt(i);
            return (
              <g key={i} data-slot={`point-${i}`}>
                <circle cx={p.x} cy={p.y} r={1.6 * (0.4 + 0.6 * on)} fill={highlightColor} opacity={on} />
              </g>
            );
          })}
        </svg>

        <div style={{display: 'flex', flexDirection: 'row', justifyContent: 'space-between', marginTop: scaleFont(width, height, 12)}}>
          {points.map((p, i) => {
            const on = onAt(i);
            return (
              <span
                key={i}
                data-slot={`point-${i}-at`}
                style={{fontFamily: FONT_CN, color: theme.footnote, fontSize: scaleFont(width, height, 22), opacity: on}}
              >
                {p.at}
              </span>
            );
          })}
        </div>
      </div>

      {slots.note ? (
        <Live seed={3} from={drawArriveAt} style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 26), color: theme.footnote, marginTop: scaleFont(width, height, 20)}}>
          <span data-slot="note">{slots.note}</span>
        </Live>
      ) : null}
    </AbsoluteFill>
  );
};
