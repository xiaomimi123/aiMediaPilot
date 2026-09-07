import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_CN} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';
import {CardTheme} from '../theme';
import {fadeUp, slideIn} from '../motion/anim';
import {resolveAccent, scaleStyle, speedT, ShotStyle} from './style';

/** 名牌之间的错峰间隔(nominal 秒)——spec §2.2: 第 i 块 `t(0.2 + i×0.5)` 起播。 */
const CHIP_GAP_SEC = 0.5;
const CHIP_FIRST_AT_SEC = 0.2;

/**
 * 人物/机构名牌卡：横向 1~3 块名牌, 逐块滑入 + 可选右侧注脚。
 *
 * 骨架同源 ListCard: safeBox 定位、scaleFont 定字号、flex 横向排布、
 * assertContent 校验必填、颜色一律读 theme。
 *
 * 逐块进场即常驻(spec §2.2): `slideIn` 本身把 progress clamp 到 [0,1],
 * 到位后就恒定在终态(opacity=1, translateX=0), 不需要额外的"常驻"逻辑——
 * 与 ListCard 的条目同一取舍(staggerIn 同理)。
 *
 * tone 配色: `light` 用浅底深字(theme.highlight 系, 见下方 chipStyle 的实测
 * 说明——不是 theme.background), `dark` 用深底浅字(theme.title 系) + accent
 * 色的 sub——两种底色在同一张卡上并置时才有"名牌"的实物质感(不同机构用不同
 * 底色区分), 而不是一片同色文字。
 *
 * 名牌内文字不加阴影: 实心色块背景上叠阴影会显脏(Live/其它卡片没有全局阴影,
 * 这里其实不需要覆盖, 但显式写 `textShadow:'none'` 是留一道防线——万一将来
 * 有卡片级别的阴影配置, 名牌不应该被波及)。
 *
 * 重复结构可拖动的落点(spec §四, 下一期用): 每块名牌各自包在一层带
 * `data-slot={\`chip-${i}\`}` 标记的容器里, 整块(名字+副标题)是一个拖动单位;
 * 块内的 name/sub 再各自带自己的 data-slot, 供未来更细粒度地拖动单个文字。
 */
export const Entity: React.FC<{
  slots: {
    chips: Array<{name: string; sub?: string; tone: 'light' | 'dark'}>;
    note?: string;
  };
  durationInFrames: number;
  theme: CardTheme;
  style?: ShotStyle;
}> = ({slots, theme, style}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);
  const chips = slots.chips.map((chip, i) => ({
    ...chip,
    name: assertContent(chip.name, `entity.chips[${i}].name`),
  }));
  const t = speedT(style);
  const accentColor = resolveAccent(style?.accent, theme, theme.accent);

  const lastChipArriveAt = t(CHIP_FIRST_AT_SEC) + (chips.length - 1) * CHIP_GAP_SEC + 0.5;
  const noteFade = fadeUp(frame, fps, lastChipArriveAt);

  const highlightColor = resolveAccent(style?.accent, theme, theme.highlight);
  // 本项目修改(实测发现): `light` 最初实现用 `theme.background` 当底色——
  // 在 card 主题下这个值(#f3eeeb)与卡面本身的暗角渐变(Ambient)最亮处
  // 几乎同色, 名牌等于"只剩一条 2px 描边", 视觉上近乎隐形。改用
  // `theme.highlight`(卡面已有的强调色, 与背景色差够大)当"浅底"——
  // 仍然是"比 dark 版浅、比背景本身跳"的一块牌子, 只是"浅"从"贴近纸白"
  // 换成"贴近主题的高亮色", 两种 tone 在任何主题下都与背景有足够反差。
  const chipStyle = (tone: 'light' | 'dark'): React.CSSProperties =>
    tone === 'light'
      ? {background: highlightColor, color: theme.title}
      : {background: theme.title, color: theme.background};

  return (
    <AbsoluteFill
      style={{
        padding: `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`,
        justifyContent: 'center',
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
        ...scaleStyle(style),
      }}
    >
      <div style={{display: 'flex', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center'}}>
        {chips.map((chip, i) => {
          const atSec = t(CHIP_FIRST_AT_SEC) + i * CHIP_GAP_SEC;
          const arriveAt = atSec + 0.5;
          const entrance = slideIn(frame, fps, atSec, 'left');
          const tone = chipStyle(chip.tone);
          const subColor = chip.tone === 'dark' ? accentColor : theme.accent;
          return (
            // data-slot 挂在外层这层静态容器上——Live 只透传 style/className,
            // 不透传任意 props(见 motion/life.tsx 的类型), 挂在 Live 上不会
            // 真正落到 DOM 里。外层容器本身不带动效, 视觉滑入由内层 Live 的
            // transform 承担, 但"整块是一个单位"这件事由外层容器的 data-slot
            // 边界来定义(下一期拖动功能靠这个查找 + 量整块的包围盒)。
            <div key={i} data-slot={`chip-${i}`} style={{minWidth: 0, margin: scaleFont(width, height, 12)}}>
              <Live
                seed={10 + i}
                from={arriveAt}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: `${scaleFont(width, height, 20)}px ${scaleFont(width, height, 32)}px`,
                  borderRadius: scaleFont(width, height, 16),
                  ...tone,
                  ...entrance,
                }}
              >
                <span
                  data-slot={`chip-${i}-name`}
                  style={{
                    fontFamily: FONT_CN, fontWeight: 900, fontSize: scaleFont(width, height, 40),
                    lineHeight: 1.2, textShadow: 'none',
                  }}
                >
                  {chip.name}
                </span>
                {chip.sub ? (
                  <span
                    data-slot={`chip-${i}-sub`}
                    style={{
                      fontFamily: FONT_CN, fontSize: scaleFont(width, height, 24), color: subColor,
                      marginTop: scaleFont(width, height, 8), textShadow: 'none',
                    }}
                  >
                    {chip.sub}
                  </span>
                ) : null}
              </Live>
            </div>
          );
        })}
      </div>

      {slots.note ? (
        <div
          data-slot="note"
          style={{
            fontFamily: FONT_CN, fontSize: scaleFont(width, height, 26), color: theme.footnote,
            marginLeft: scaleFont(width, height, 24), ...noteFade,
          }}
        >
          {slots.note}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
