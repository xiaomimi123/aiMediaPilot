import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_CN, roundToSourceDecimals} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';
import {CardTheme} from '../theme';
import {fadeUp, barGrow, countTo} from '../motion/anim';
import {resolveAccent, scaleStyle, speedT, ShotStyle} from './style';

/** 逐行错峰间隔(spec §2.4, 任务书原话"逐行错峰 0.14s")。 */
const ROW_GAP_SEC = 0.14;
/** 条形 0.9s(与 barGrow 内部硬编码的时长一致, 这里只是给注释和 arrive 计算用),
 * 数字 1.4s——两者故意不对齐(spec §2.4: "条先到位、数字还在滚,保留这个错落")。 */
const BAR_DUR_SEC = 0.9;
const VALUE_DUR_SEC = 1.4;

/**
 * 排名条卡：标题 + 每行(名字/数字 + 一条能比长短的横条), 最高值那行用 accent
 * 色强调, 其余降调。
 *
 * 骨架同源 ListCard/Ring: safeBox 定位、scaleFont 定字号、flex 纵向排布、
 * assertContent 校验必填、颜色一律读 theme。
 *
 * ratio 夹紧(控制者裁决, 与 Ring 的 ratio 夹紧同一先例——见 Ring.tsx 注释):
 * 这张卡没有像 Ring 那样显式的 `max` 槽位, "最大值"是从 `rows` 本身现算出来的
 * (`Math.max(...values)`)。条形的物理意义(一根横条的长度)只能画在
 * `[0, 轨道满长]` 之间, 所以 `value / 最大值` 要夹到 `[0,1]`:
 * - 若某行 value 为负、最大值为正: 除出来是负数, 夹到 0(负值没有对应的"长度",
 *   显示成空条是离谱输入下最不误导的呈现——与 Ring 的做法一致)。
 * - 若最大值本身 ≤ 0(所有行都非正, 没有一个能当"满条"的参照): 分母退化,
 *   这里选择让所有条形都显示为空(ratio=0), 而不是用一个 ≤0 的数当分母继续
 *   相除(那样会把符号算反, 比如 -5 / -10 = 0.5 却在语义上完全说反了"谁更大")——
 *   "没有正值可比较大小"时, 与其画出一组方向搞反的条形, 不如全空更不误导。
 *
 * 行内数字**不夹**, 仍显示真实的 value(可能是负数), 因为数字是可查证的事实,
 * 只有条形的几何长度受"轨道只能画在 [0,1] 之间"这个物理约束——与 Ring 的
 * "环心数字不夹"是同一条取舍。
 *
 * 条形与数字故意不对齐(spec §2.4): `barGrow` 内部时长固定 0.9s, `countTo`
 * 这里显式传 1.4s——同一行的条形先到位, 数字还在滚一会儿才停, 这个错落是
 * 手法的一部分, 不是没对齐好。
 *
 * 最高值行的着色(spec §2.4 "最高值那行用 accent 色，其余降调"): 名字文案
 * 所有行统一用 `theme.title`(可读性优先, 排名条最终要让人看清"是什么"),
 * 真正体现"哪行最高"的是条形填充色与数字颜色——最高值那行用 accentColor,
 * 其余行降调成 `theme.footnote`(已含透明度的弱化色, 与 Ring 未命中描边圈同
 * 一 token)。
 */
export const Rank: React.FC<{
  slots: {title: string; rows: Array<{name: string; value: number}>; suffix?: string};
  durationInFrames: number;
  theme: CardTheme;
  style?: ShotStyle;
}> = ({slots, theme, style}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);
  const title = assertContent(slots.title, 'rank.title');
  const rows = slots.rows.map((r, i) => ({
    name: assertContent(r.name, `rank.rows[${i}].name`),
    value: r.value,
  }));
  const t = speedT(style);
  const accentColor = resolveAccent(style?.accent, theme, theme.accent);

  const maxValue = Math.max(...rows.map((r) => r.value));
  // 最高值那一行(取第一个命中最大值的下标——并列时不特别区分谁是"最高", 见上方注释)。
  const topIndex = rows.findIndex((r) => r.value === maxValue);

  const titleFade = fadeUp(frame, fps, t(0));
  const firstRowAtSec = t(0.3);

  return (
    <AbsoluteFill
      style={{
        padding: `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`,
        justifyContent: 'center',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...scaleStyle(style),
      }}
    >
      <Live seed={0} style={{fontFamily: FONT_CN, fontWeight: 900, color: theme.title, fontSize: scaleFont(width, height, 44), ...titleFade}}>
        {title}
      </Live>

      <div style={{display: 'flex', flexDirection: 'column', marginTop: scaleFont(width, height, 24)}}>
        {rows.map((row, i) => {
          const atSec = firstRowAtSec + i * ROW_GAP_SEC;
          const barArriveAt = atSec + BAR_DUR_SEC;
          const valueArriveAt = atSec + VALUE_DUR_SEC;
          const isTop = i === topIndex;
          const ink = isTop ? accentColor : theme.footnote;

          // 见组件头注释: 最大值 ≤ 0 时没有可比较的正值参照, 全体条形显示为空;
          // 否则按 value/maxValue 夹到 [0,1]。
          const ratio = maxValue <= 0 ? 0 : Math.min(1, Math.max(0, row.value / maxValue));
          const bar = barGrow(frame, fps, atSec, ratio);
          const shownValue = roundToSourceDecimals(countTo(frame, fps, atSec, row.value, VALUE_DUR_SEC), row.value);

          return (
            <div
              key={i}
              data-slot={`row-${i}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                marginTop: i === 0 ? 0 : scaleFont(width, height, 22),
              }}
            >
              <div style={{display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline'}}>
                <Live
                  seed={10 + i}
                  from={barArriveAt}
                  style={{fontFamily: FONT_CN, color: theme.title, fontSize: scaleFont(width, height, 32)}}
                >
                  <span data-slot={`row-${i}-name`}>{row.name}</span>
                </Live>
                <Live
                  seed={20 + i}
                  from={valueArriveAt}
                  style={{fontFamily: FONT_CN, fontWeight: 900, color: ink, fontSize: scaleFont(width, height, 32)}}
                >
                  <span data-slot={`row-${i}-value`}>{shownValue}{slots.suffix ?? ''}</span>
                </Live>
              </div>
              <div
                style={{
                  height: scaleFont(width, height, 14),
                  borderRadius: scaleFont(width, height, 7),
                  background: theme.footnote,
                  marginTop: scaleFont(width, height, 8),
                  overflow: 'hidden',
                }}
              >
                {/*
                  轨道(灰底)与填充条不用 position:absolute 叠放: 填充条是
                  轨道容器唯一的子元素, `width:'100%'` 撑满轨道后再靠
                  `transform:scaleX(ratio)` + `transformOrigin:'left center'`
                  从左端收缩/长出——单靠正常文档流(容器套一个 100% 宽的子元素)
                  加 transform 就够, 不需要脱离布局去摆坐标。
                */}
                <div style={{width: '100%', height: '100%', borderRadius: 'inherit', background: ink, ...bar}} />
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
