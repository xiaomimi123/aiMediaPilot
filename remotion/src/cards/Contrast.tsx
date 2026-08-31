import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {C, FONT_CN} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';

const CONNECTOR_GLYPH: Record<'arrow' | 'versus' | 'plus', string> = {
  arrow: '→',
  versus: 'VS',
  plus: '+',
};

/**
 * 对照卡：左右两组东西 + 中间连接符, 讲 A 与 B 的对照或转变。
 *
 * 左右两列用 flex row 平分, 连接符居中 —— 不用绝对坐标摆放三块内容。
 * `connector` 不可省: 少了它就只是两张卡并排摆着, 不构成一个论断
 * (这条约束在 shot-plan.ts 的 schema 里也是必填, 这里只是把它画出来)。
 */
export const Contrast: React.FC<{
  slots: {
    leftLabel: string;
    leftText: string;
    rightLabel: string;
    rightText: string;
    connector: 'arrow' | 'versus' | 'plus';
  };
  durationInFrames: number;
}> = ({slots}) => {
  const {width, height} = useVideoConfig();
  const box = safeBox(width, height);
  const leftText = assertContent(slots.leftText, 'contrast.leftText');
  const rightText = assertContent(slots.rightText, 'contrast.rightText');
  const leftLabel = assertContent(slots.leftLabel, 'contrast.leftLabel');
  const rightLabel = assertContent(slots.rightLabel, 'contrast.rightLabel');

  const column = (label: string, text: string, seed: number) => (
    <div style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'}}>
      <Live seed={seed} style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 28), color: C.blue, letterSpacing: '0.1em'}}>
        {label}
      </Live>
      <Live
        seed={seed + 1}
        style={{
          fontFamily: FONT_CN, fontWeight: 900, color: C.ink, marginTop: scaleFont(width, height, 14),
          fontSize: scaleFont(width, height, 56), lineHeight: 1.15,
        }}
      >
        {text}
      </Live>
    </div>
  );

  return (
    <AbsoluteFill
      style={{
        padding: `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`,
        justifyContent: 'center',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      {column(leftLabel, leftText, 1)}
      <Live
        seed={5}
        style={{
          fontFamily: FONT_CN, fontWeight: 900, color: C.red,
          fontSize: scaleFont(width, height, 48), padding: `0 ${scaleFont(width, height, 24)}px`,
        }}
      >
        {CONNECTOR_GLYPH[slots.connector]}
      </Live>
      {column(rightLabel, rightText, 3)}
    </AbsoluteFill>
  );
};
