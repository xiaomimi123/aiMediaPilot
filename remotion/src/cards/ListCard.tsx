import React from 'react';
import {AbsoluteFill, useVideoConfig, useCurrentFrame} from 'remotion';
import {FONT_CN} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';
import {CardTheme} from '../theme';
import {staggerIn} from '../motion/anim';
import {resolveAccent, scaleStyle, speedT, ShotStyle} from './style';

/** 条目错峰间隔(nominal 秒, 走 speedT 的 t() 之外的独立参数——见下方调用处注释)。 */
const STAGGER_GAP_SEC = 0.12;

/**
 * 列表卡：标题 + 条目错峰入场, 用"多"本身说明问题。
 *
 * 动效(三十二期 Task 3): 条目入场原来是本卡自己手写的 interpolate(位移 20px、
 * cubic ease-out、0.35s), 现在换成 `anim.ts` 的 `staggerIn`(fadeUp + index 错峰,
 * 位移 18px、0.5s) —— 同一类"多条依次冒出来"的手法, 四张卡不必各抄一份。
 * `staggerIn` 的 `atSec` 参数(第一条起播时刻)走 `t()`; 条目之间的错峰间隔
 * `gapSec` 是"多久出下一条"这个节奏细节, 不是"整体几时开始", 这里保留常量
 * 不随 speed 缩放——与 Stat 卡把 beatHit 之外的既有数字滚动逻辑保持原样是
 * 同一取舍: 只缩放"入口时刻", 不重新发明每个手法内部的节奏参数。
 */
export const ListCard: React.FC<{
  slots: {title: string; items: string[]};
  durationInFrames: number;
  theme: CardTheme;
  style?: ShotStyle;
}> = ({slots, theme, style}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);
  const title = assertContent(slots.title, 'list.title');
  const items = slots.items.map((item, i) => assertContent(item, `list.items[${i}]`));
  const t = speedT(style);
  const highlightColor = resolveAccent(style?.accent, theme, theme.highlight);

  const firstItemAtSec = t(0.4);

  return (
    <AbsoluteFill
      style={{
        padding: `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`,
        justifyContent: 'center',
        display: 'flex',
        flexDirection: 'column',
        // 兜底(审查 Important #1): 压力样片(title 16 字 + 8 条 × 20 字, schema 上限)
        // 实测没挤出安全区, overflow:hidden 是防未来更极端输入(比如条目更多)的
        // 最后一道线——超出后果是内容被裁掉看不全, 而不是挣脱安全区把字幕挤没。
        overflow: 'hidden',
        ...scaleStyle(style),
      }}
    >
      <Live seed={0} style={{fontFamily: FONT_CN, fontWeight: 900, color: theme.title, fontSize: scaleFont(width, height, 52)}}>
        {title}
      </Live>
      <div style={{display: 'flex', flexDirection: 'column', marginTop: scaleFont(width, height, 28)}}>
        {items.map((item, i) => {
          const entrance = staggerIn(frame, fps, firstItemAtSec, i, STAGGER_GAP_SEC);
          const arriveAt = firstItemAtSec + i * STAGGER_GAP_SEC + 0.5;
          return (
            <div
              key={i}
              style={{
                marginTop: i === 0 ? 0 : scaleFont(width, height, 18),
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'baseline',
                ...entrance,
              }}
            >
              <span style={{fontFamily: FONT_CN, fontWeight: 900, color: highlightColor, fontSize: scaleFont(width, height, 36), marginRight: scaleFont(width, height, 16)}}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <Live seed={10 + i} from={arriveAt} style={{fontFamily: FONT_CN, color: theme.title, fontSize: scaleFont(width, height, 36)}}>
                {item}
              </Live>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
