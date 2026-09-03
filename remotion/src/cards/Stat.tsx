import React from 'react';
import {AbsoluteFill, useVideoConfig, useCurrentFrame, interpolate, Easing} from 'remotion';
import {FONT_CN, roundToSourceDecimals} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';
import {CardTheme} from '../theme';

/**
 * 数字卡：一个数值是主角，从 0 数上去。
 *
 * 不用 motion/components.tsx 的 NumberRoll —— 那个是绝对定位(x/y 必填), 与本项目的
 * 栅格约束冲突。这里复用它的"数上去"手法, 但位置交给 flex。
 *
 * 颜色不再写死——一律读 `theme`(二十九期 Task 1)。
 */
export const Stat: React.FC<{
  slots: {label: string; value: number; prefix?: string; suffix?: string; note?: string};
  durationInFrames: number;
  theme: CardTheme;
}> = ({slots, durationInFrames, theme}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);
  const label = assertContent(slots.label, 'stat.label');

  const countDur = Math.min(fps * 1.6, durationInFrames * 0.5);
  const p = interpolate(frame, [fps * 0.6, fps * 0.6 + countDur], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  // 本项目修改(2026-08-31)：取整不能一律 Math.round —— facts 台账里 32.2% 这类
  // 非整数 value，末帧定格若取整成 32 就和台账不再逐位一致(见 lib.tsx 的
  // roundToSourceDecimals 注释)。取整精度跟随 value 自身的小数位数。
  const shown = roundToSourceDecimals(p * slots.value, slots.value);

  return (
    <AbsoluteFill
      style={{
        padding: `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`,
        justifyContent: 'center',
        display: 'flex',
        flexDirection: 'column',
        // 兜底(审查 Important #1): schema 里 value 是裸 z.number(), 没有位数上限——
        // 24 字/16 字这类字符串槽位实测扛得住(见压力样片), 但数值理论上可以任意长。
        // overflow:hidden 保证"万一真的挤爆了, 也只是被裁掉, 不会挣脱安全区"——
        // 这是最后一道防线, 不是排版方案, 正常长度的内容不会触发它。
        overflow: 'hidden',
      }}
    >
      <Live seed={1} style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 34), color: theme.accent, letterSpacing: '0.12em'}}>
        {label}
      </Live>
      <Live
        seed={2}
        style={{
          fontFamily: FONT_CN, fontWeight: 900, color: theme.highlight, marginTop: scaleFont(width, height, 16),
          fontSize: scaleFont(width, height, 170), lineHeight: 1.05,
          WebkitTextStroke: `${scaleFont(width, height, 6)}px ${theme.stroke}`, paintOrder: 'stroke',
          // value 是一串不含空格的数字, 默认 word-break 不会在数字中间断行——
          // 加 overflowWrap 让极端位数的数字至少能换行, 而不是顶着 overflow:hidden
          // 被整体裁掉看不全。仍然只是兜底: 位数一旦夸张, 观感必然变差, 但不会越界。
          maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word',
        }}
      >
        {slots.prefix ?? ''}{shown}{slots.suffix ?? ''}
      </Live>
      {slots.note ? (
        // theme.footnote 已含透明度(见 theme.ts), 不再需要额外叠一层 opacity。
        <Live seed={3} style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 26), color: theme.footnote, marginTop: scaleFont(width, height, 20)}}>
          {slots.note}
        </Live>
      ) : null}
    </AbsoluteFill>
  );
};
