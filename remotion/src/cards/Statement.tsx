import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_CN} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';
import {CardTheme} from '../theme';
import {fadeUp, smashIn, sweepHighlight} from '../motion/anim';
import {resolveAccent, scaleStyle, speedT, ShotStyle} from './style';

/**
 * 判断卡：大字一句判断 + 可选副句。用于开场、转折、收尾这类需要停顿的地方。
 *
 * 骨架与 Stat 同源: safeBox 定位、scaleFont 定字号、flex 纵向排布、Live 接管
 * 入场之后的 idle 与"让位"生命周期 —— 不用绝对坐标。
 *
 * 颜色不再写死——一律读 `theme`(二十九期 Task 1), 由 `Film` 按 `visualStyle`
 * 选一份 `THEMES['card' | 'illustration']` 传下来。
 *
 * 动效(三十二期 Task 3): 主文案 `smashIn`(过冲砸落) + 全句下方一条 `sweepHighlight`
 * 扫过的记号笔强调条——这张卡只有 text/sub 两个槽位, 没有单独的"关键词"槽位,
 * 所以把主文案整句当作画面唯一要强调的"关键词"处理, 而不是新开一个字段
 * (brief 明确不改 schema)。副文案延迟 `fadeUp`。`Live` 不再兼管入场,
 * `from` 各自设成对应 anim 结束的时刻, 交棒给 idle。
 */
export const Statement: React.FC<{
  slots: {text: string; sub?: string};
  durationInFrames: number;
  theme: CardTheme;
  style?: ShotStyle;
}> = ({slots, theme, style}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);
  const text = assertContent(slots.text, 'statement.text');
  const t = speedT(style);
  const accentColor = resolveAccent(style?.accent, theme.accent);

  // 主文案: smashIn 在 0.3s(nominal)起播, 内部固定时长 0.42s —— 数值来自
  // anim.ts 的手法设计, 不由本卡自行改动。
  const mainSmash = smashIn(frame, fps, t(0.3));
  const mainArriveAt = t(0.3) + 0.42;
  // 强调条紧随主文案落定后扫过, 用 accentColor 而不是写死 theme.accent,
  // 这样 style.accent 才能真的改变画面(不只是被读到没用上)。
  const sweep = sweepHighlight(frame, fps, t(0.9));
  const sweepArriveAt = t(0.9) + 0.45;

  // 副文案: 延迟 fadeUp, 等主文案与强调条都出来之后再进场。
  const subFade = fadeUp(frame, fps, t(1.1));
  const subArriveAt = t(1.1) + 0.5;

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
        ...scaleStyle(style),
      }}
    >
      <Live
        seed={1}
        from={mainArriveAt}
        style={{
          fontFamily: FONT_CN, fontWeight: 900, color: theme.title,
          fontSize: scaleFont(width, height, 72), lineHeight: 1.2,
          display: 'inline-block',
          backgroundImage: `linear-gradient(${accentColor}, ${accentColor})`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: '0 88%',
          ...mainSmash,
          ...sweep,
        }}
      >
        {text}
      </Live>
      {slots.sub ? (
        <Live
          seed={2}
          from={Math.max(mainArriveAt, sweepArriveAt, subArriveAt)}
          style={{
            fontFamily: FONT_CN, color: accentColor, marginTop: scaleFont(width, height, 24),
            fontSize: scaleFont(width, height, 32),
            ...subFade,
            // subFade 带了自己的 opacity(0→1), 但设计上副文案定妆后是 0.85 不
            // 透明度(原设计如此)——用 Math.min 让两条约束同时成立: 进场时跟着
            // subFade 走(可能小于 0.85), 到位后夹到 0.85, 不会先淡到 1 再跳回 0.85。
            opacity: Math.min(subFade.opacity as number, 0.85),
          }}
        >
          {slots.sub}
        </Live>
      ) : null}
    </AbsoluteFill>
  );
};
