import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {C, FONT_CN} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';

/**
 * 判断卡：大字一句判断 + 可选副句。用于开场、转折、收尾这类需要停顿的地方。
 *
 * 骨架与 Stat 同源: safeBox 定位、scaleFont 定字号、flex 纵向排布、Live 接管
 * 入场与"让位"生命周期 —— 不用绝对坐标。
 */
export const Statement: React.FC<{
  slots: {text: string; sub?: string};
  durationInFrames: number;
}> = ({slots}) => {
  const {width, height} = useVideoConfig();
  const box = safeBox(width, height);
  const text = assertContent(slots.text, 'statement.text');

  return (
    <AbsoluteFill
      style={{
        padding: `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`,
        justifyContent: 'center',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Live
        seed={1}
        style={{
          fontFamily: FONT_CN, fontWeight: 900, color: C.ink,
          fontSize: scaleFont(width, height, 72), lineHeight: 1.2,
        }}
      >
        {text}
      </Live>
      {slots.sub ? (
        <Live
          seed={2}
          style={{
            fontFamily: FONT_CN, color: C.blue, marginTop: scaleFont(width, height, 24),
            fontSize: scaleFont(width, height, 32), opacity: 0.85,
          }}
        >
          {slots.sub}
        </Live>
      ) : null}
    </AbsoluteFill>
  );
};
