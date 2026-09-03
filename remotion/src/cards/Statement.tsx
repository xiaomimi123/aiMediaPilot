import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {FONT_CN} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';
import {CardTheme} from '../theme';

/**
 * 判断卡：大字一句判断 + 可选副句。用于开场、转折、收尾这类需要停顿的地方。
 *
 * 骨架与 Stat 同源: safeBox 定位、scaleFont 定字号、flex 纵向排布、Live 接管
 * 入场与"让位"生命周期 —— 不用绝对坐标。
 *
 * 颜色不再写死——一律读 `theme`(二十九期 Task 1), 由 `Film` 按 `visualStyle`
 * 选一份 `THEMES['card' | 'illustration']` 传下来。
 */
export const Statement: React.FC<{
  slots: {text: string; sub?: string};
  durationInFrames: number;
  theme: CardTheme;
}> = ({slots, theme}) => {
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
        // 兜底(审查 Important #1): 压力样片(text 24 字/sub 20 字)实测没挤出安全区,
        // overflow:hidden 是防未来更极端输入的最后一道线——正常长度用不上它。
        overflow: 'hidden',
      }}
    >
      <Live
        seed={1}
        style={{
          fontFamily: FONT_CN, fontWeight: 900, color: theme.title,
          fontSize: scaleFont(width, height, 72), lineHeight: 1.2,
        }}
      >
        {text}
      </Live>
      {slots.sub ? (
        <Live
          seed={2}
          style={{
            fontFamily: FONT_CN, color: theme.accent, marginTop: scaleFont(width, height, 24),
            fontSize: scaleFont(width, height, 32), opacity: 0.85,
          }}
        >
          {slots.sub}
        </Live>
      ) : null}
    </AbsoluteFill>
  );
};
