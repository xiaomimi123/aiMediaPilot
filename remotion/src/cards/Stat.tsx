import React from 'react';
import {AbsoluteFill, useVideoConfig, useCurrentFrame, interpolate, Easing} from 'remotion';
import {C, FONT_CN} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';

/**
 * 数字卡：一个数值是主角，从 0 数上去。
 *
 * 不用 motion/components.tsx 的 NumberRoll —— 那个是绝对定位(x/y 必填), 与本项目的
 * 栅格约束冲突。这里复用它的"数上去"手法, 但位置交给 flex。
 */
export const Stat: React.FC<{
  slots: {label: string; value: number; prefix?: string; suffix?: string; note?: string};
  durationInFrames: number;
}> = ({slots, durationInFrames}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);
  const label = assertContent(slots.label, 'stat.label');

  const countDur = Math.min(fps * 1.6, durationInFrames * 0.5);
  const p = interpolate(frame, [fps * 0.6, fps * 0.6 + countDur], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const shown = Math.round(p * slots.value);

  return (
    <AbsoluteFill
      style={{
        padding: `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`,
        justifyContent: 'center',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Live seed={1} style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 34), color: C.blue, letterSpacing: '0.12em'}}>
        {label}
      </Live>
      <Live
        seed={2}
        style={{
          fontFamily: FONT_CN, fontWeight: 900, color: C.yellow, marginTop: scaleFont(width, height, 16),
          fontSize: scaleFont(width, height, 170), lineHeight: 1.05,
          WebkitTextStroke: `${scaleFont(width, height, 6)}px ${C.ink}`, paintOrder: 'stroke',
        }}
      >
        {slots.prefix ?? ''}{shown}{slots.suffix ?? ''}
      </Live>
      {slots.note ? (
        <Live seed={3} style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 26), color: C.ink, opacity: 0.55, marginTop: scaleFont(width, height, 20)}}>
          {slots.note}
        </Live>
      ) : null}
    </AbsoluteFill>
  );
};
