import React from 'react';
import {AbsoluteFill, useVideoConfig, useCurrentFrame, interpolate, Easing} from 'remotion';
import {C, FONT_CN} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';

/**
 * 列表卡：标题 + 条目错峰入场, 用"多"本身说明问题。
 *
 * 条目延迟 `i * 0.12s` 依次入场是本卡独有的效果, `Live` 组件本身不管入场
 * (它管的是"到位之后别僵住、让位时视觉上退场"这条 L3/L4 生命周期), 所以
 * 每条目额外套一层用 interpolate 算的进场动画, 再把 `Live` 包在里面接管
 * 到位之后的呼吸感 —— 两层各司其职, 都不需要绝对坐标。
 */
export const ListCard: React.FC<{
  slots: {title: string; items: string[]};
  durationInFrames: number;
}> = ({slots}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);
  const title = assertContent(slots.title, 'list.title');
  const items = slots.items.map((item, i) => assertContent(item, `list.items[${i}]`));

  const entranceDur = fps * 0.35;

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
      }}
    >
      <Live seed={0} style={{fontFamily: FONT_CN, fontWeight: 900, color: C.ink, fontSize: scaleFont(width, height, 52)}}>
        {title}
      </Live>
      <div style={{display: 'flex', flexDirection: 'column', marginTop: scaleFont(width, height, 28)}}>
        {items.map((item, i) => {
          const itemStart = fps * 0.4 + i * fps * 0.12;
          const p = interpolate(frame, [itemStart, itemStart + entranceDur], [0, 1], {
            extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
          });
          return (
            <div
              key={i}
              style={{
                opacity: p,
                transform: `translateY(${(1 - p) * 20}px)`,
                marginTop: i === 0 ? 0 : scaleFont(width, height, 18),
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'baseline',
              }}
            >
              <span style={{fontFamily: FONT_CN, fontWeight: 900, color: C.yellow, fontSize: scaleFont(width, height, 36), marginRight: scaleFont(width, height, 16)}}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <Live seed={10 + i} style={{fontFamily: FONT_CN, color: C.ink, fontSize: scaleFont(width, height, 36)}}>
                {item}
              </Live>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
