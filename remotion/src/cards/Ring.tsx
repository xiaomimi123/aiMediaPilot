import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_CN, roundToSourceDecimals} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';
import {CardTheme} from '../theme';
import {fadeUp, ringDraw, countTo} from '../motion/anim';
import {resolveAccent, scaleStyle, speedT, ShotStyle} from './style';

/** SVG viewBox 边长与半径 —— 圆环描画手法约定的固定几何(spec §2.1)。 */
const VIEW = 320;
const RADIUS = 140;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * 圆环卡：一个占比/达成率, 用一圈描画的进度环 + 环心数字表达。
 *
 * 骨架同源 Statement/Stat: safeBox 定位、scaleFont 定字号、flex 纵向排布、
 * assertContent 校验必填、颜色一律读 theme。
 *
 * ratio 夹紧(控制者裁决): `value/max` 可能大于 1(达成率 120%)或为负——
 * 这是"这张卡怎么理解自己的数据", 属于组件层的业务判断, 不塞进 `ringDraw`
 * (那是纯时间函数, 不该懂"占比"这个语义)。夹到 [0,1] 是因为一个圆环的
 * "画多长"物理上就只能在一整圈以内, 超过 100% 或负数都没有对应的几何——
 * 与其画出一个荒谬的形状(比如倒转半圈), 不如夹到边界让观众看到"满环"或
 * "空环", 这是離谱输入下最不误导的呈现。环心数字**不夹**, 仍显示真实的
 * value(可能是 120%), 因为数字是可查证的事实, 只有几何形状受物理约束。
 *
 * 环与数字同步: 两者用同一个 atSec(t(0.3))、同一个时长(0.9s) 驱动 ——
 * `ringDraw` 用 `ratio`(夹紧后), `countTo` 用 `value`(未夹紧) —— 由 frame
 * 统一驱动, 天然同步, 不需要像 overlay-studio 那样手动对齐两套时钟。
 *
 * 环心数字绝对居中(全局约束: 版面禁止 position:absolute, 但环心数字若不叠在
 * 环正中心就失去意义)。这里改用 grid 重叠方案: SVG 与数字容器都放进同一个
 * `display:grid` 容器、都 `gridArea:'1/1'`——两者天然重叠居中, 不需要摸坐标。
 */
export const Ring: React.FC<{
  slots: {label: string; value: number; max?: number; suffix?: string; note?: string};
  durationInFrames: number;
  theme: CardTheme;
  style?: ShotStyle;
}> = ({slots, theme, style}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);
  const label = assertContent(slots.label, 'ring.label');
  const t = speedT(style);
  const accentColor = resolveAccent(style?.accent, theme, theme.accent);
  const highlightColor = resolveAccent(style?.accent, theme, theme.highlight);

  const max = slots.max ?? 100;
  // 夹到 [0,1] —— 见上方类注释: 圆环的几何只能画满一整圈, 超界/负值都没有
  // 对应的形状, 夹到边界是离谱输入下最不误导的呈现。
  const ratio = Math.min(1, Math.max(0, max === 0 ? 0 : slots.value / max));

  const ringAtSec = t(0.3);
  const ringArriveAt = ringAtSec + 0.9;
  const ring = ringDraw(frame, fps, ringAtSec, ratio, CIRCUMFERENCE);
  const shownValue = roundToSourceDecimals(countTo(frame, fps, ringAtSec, slots.value, 0.9), slots.value);

  const labelFade = fadeUp(frame, fps, t(0));
  const labelArriveAt = t(0) + 0.5;

  const ringSize = Math.min(box.innerWidth, box.innerHeight) * 0.55;

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
      <Live
        seed={1}
        from={labelArriveAt}
        style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 34), color: accentColor, letterSpacing: '0.12em', ...labelFade}}
      >
        <span data-slot="label">{label}</span>
      </Live>

      {/*
        grid 重叠居中: SVG 环与环心数字都占同一个 gridArea, grid 天然把两者
        叠在一起并居中——不用 position:absolute 摆数字。
      */}
      <div
        style={{
          display: 'grid',
          width: ringSize,
          height: ringSize,
          marginTop: scaleFont(width, height, 24),
        }}
      >
        <svg
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          width={ringSize}
          height={ringSize}
          style={{gridArea: '1 / 1', transform: 'rotate(-90deg)'}}
        >
          <circle cx={VIEW / 2} cy={VIEW / 2} r={RADIUS} fill="none" stroke={theme.footnote} strokeWidth={16} />
          <circle
            cx={VIEW / 2} cy={VIEW / 2} r={RADIUS} fill="none"
            stroke={highlightColor} strokeWidth={16} strokeLinecap="round"
            style={ring}
          />
        </svg>
        <Live
          seed={2}
          from={ringArriveAt}
          style={{
            gridArea: '1 / 1',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            data-slot="value"
            style={{
              fontFamily: FONT_CN, fontWeight: 900, color: theme.title,
              fontSize: scaleFont(width, height, 68), lineHeight: 1,
            }}
          >
            {shownValue}{slots.suffix ?? ''}
          </span>
        </Live>
      </div>

      {slots.note ? (
        // note 等环画完再出现——ringArriveAt 是环描画结束的时刻, 与 Stat 卡
        // "副文案等主文案定妆" 同一节奏取舍。
        <Live seed={3} from={ringArriveAt} style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 26), color: theme.footnote, marginTop: scaleFont(width, height, 24)}}>
          <span data-slot="note">{slots.note}</span>
        </Live>
      ) : null}
    </AbsoluteFill>
  );
};
