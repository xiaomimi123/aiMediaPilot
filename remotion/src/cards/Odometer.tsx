import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_CN} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';
import {CardTheme} from '../theme';
import {fadeUp, countTo} from '../motion/anim';
import {resolveAccent, scaleStyle, speedT, ShotStyle} from './style';

/** 每位数字之间的错峰间隔(nominal 秒, 与 ListCard 的 STAGGER_GAP_SEC 同一取舍:
 * 是"多久轮到下一位"这个节奏细节, 不随 speed 缩放)。 */
const DIGIT_GAP_SEC = 0.11;
/** 单个数字滚轮的滚动时长——与 Ring 的 ringDraw 用同一节奏量级(0.9s)。 */
const DIGIT_ROLL_SEC = 0.9;

/**
 * 单个数字位的滚轮: overflow:hidden 的窗口里叠放 0-9 十个格子, 用
 * `translateY(-shown × 单格高度)` 把目标数字转到窗口正中。`shown` 是
 * `countTo` 给出的连续浮点值(不取整)——这正是"真实连续滚动"的关键: 数字
 * 在滚动过程中会经过中间格子的一部分, 而不是像 overlay-studio 那样靠 CSS
 * transition 一次性跳到终值。Remotion 下这比做"跳变 + 补间"更简单, 因为
 * frame 本身就是连续时间轴, 直接把它喂给 countTo 拿到的浮点数当位移用即可。
 */
const DigitWheel: React.FC<{
  digit: number; digitH: number; fontSize: number; color: string; stroke: string;
  frame: number; fps: number; atSec: number;
}> = ({digit, digitH, fontSize, color, stroke, frame, fps, atSec}) => {
  const shown = countTo(frame, fps, atSec, digit, DIGIT_ROLL_SEC);
  return (
    <div style={{width: fontSize * 0.68, height: digitH, overflow: 'hidden'}}>
      <div style={{transform: `translateY(${-shown * digitH}px)`}}>
        {Array.from({length: 10}, (_, n) => (
          <div
            key={n}
            style={{
              height: digitH, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: FONT_CN, fontWeight: 900, fontSize, lineHeight: `${digitH}px`,
              color, WebkitTextStroke: `${Math.max(1, Math.round(fontSize * 0.03))}px ${stroke}`, paintOrder: 'stroke',
            }}
          >
            {n}
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * 翻牌计数卡：一个整数从 0 逐位滚动到位, 用于强调"这是累计出来的数"。
 *
 * 骨架同源 Stat/Ring: safeBox 定位、scaleFont 定字号、flex 纵向排布、
 * assertContent 校验必填、颜色一律读 theme。
 *
 * 逐位错峰(spec §2.2): 第 i 位(从个位数起, i=0 是个位)延迟 `i × 0.11s` 起播,
 * 让画面呈现"从高位到个位依次停下"的翻牌机质感, 而不是所有位同时归零同时
 * 停摆——那样看不出"滚动"这个动作本身。
 */
export const Odometer: React.FC<{
  slots: {label: string; value: number; suffix?: string; note?: string};
  durationInFrames: number;
  theme: CardTheme;
  style?: ShotStyle;
}> = ({slots, theme, style}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);
  const label = assertContent(slots.label, 'odometer.label');
  const t = speedT(style);
  const accentColor = resolveAccent(style?.accent, theme, theme.accent);
  const highlightColor = resolveAccent(style?.accent, theme, theme.highlight);

  // 整数取绝对值逐位拆——符号(如有负数)静态显示在数字前面, 不参与滚动
  // (滚轮只对 0-9 这十个数字格建模, 符号没有对应的格子)。
  const intValue = Math.round(slots.value);
  const digitsStr = String(Math.abs(intValue));
  const negative = intValue < 0;

  const labelFade = fadeUp(frame, fps, t(0));
  const labelArriveAt = t(0) + 0.5;

  const fontSize = scaleFont(width, height, 64);
  const digitH = Math.round(fontSize * 1.15);

  // 最后一位(个位)结束的时刻, 用于 suffix/note 的到位时机。
  const lastDigitArriveAt = t(0.3) + DIGIT_ROLL_SEC;

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

      <div
        data-slot="value"
        style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          marginTop: scaleFont(width, height, 24),
        }}
      >
        {negative ? (
          <span style={{fontFamily: FONT_CN, fontWeight: 900, fontSize, color: theme.title, marginRight: scaleFont(width, height, 4)}}>-</span>
        ) : null}
        {digitsStr.split('').map((ch, j) => {
          // i 是"从个位数起"的位序: 最后一个字符(j = len-1)就是个位, i=0。
          const i = digitsStr.length - 1 - j;
          const atSec = t(0.3) + i * DIGIT_GAP_SEC;
          return (
            <DigitWheel
              key={j}
              digit={Number(ch)}
              digitH={digitH}
              fontSize={fontSize}
              color={highlightColor}
              stroke={theme.stroke}
              frame={frame}
              fps={fps}
              atSec={atSec}
            />
          );
        })}
        {slots.suffix ? (
          <span style={{fontFamily: FONT_CN, fontWeight: 900, fontSize: scaleFont(width, height, 34), color: theme.title, marginLeft: scaleFont(width, height, 8)}}>
            {slots.suffix}
          </span>
        ) : null}
      </div>

      {slots.note ? (
        <Live seed={3} from={lastDigitArriveAt} style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 26), color: theme.footnote, marginTop: scaleFont(width, height, 24)}}>
          <span data-slot="note">{slots.note}</span>
        </Live>
      ) : null}
    </AbsoluteFill>
  );
};
