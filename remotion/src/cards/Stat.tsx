import React from 'react';
import {AbsoluteFill, useVideoConfig, useCurrentFrame, interpolate, Easing} from 'remotion';
import {FONT_CN, roundToSourceDecimals} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';
import {CardTheme} from '../theme';
import {beatHit, fadeUp} from '../motion/anim';
import {resolveAccent, scaleStyle, speedT, ShotStyle} from './style';

/**
 * 数字卡：一个数值是主角，从 0 数上去。
 *
 * 不用 motion/components.tsx 的 NumberRoll —— 那个是绝对定位(x/y 必填), 与本项目的
 * 栅格约束冲突。这里复用它的"数上去"手法, 但位置交给 flex。
 *
 * 颜色不再写死——一律读 `theme`(二十九期 Task 1)。
 *
 * 动效(三十二期 Task 3): 数字滚动本身**不动**(brief 明确"保留现有数字滚动") ——
 * `p`/`shown` 的算法照旧, 不套 `speedT` 的 `t`, 是本卡唯一不走"所有 anim 调用的
 * atSec 走 t()"这条规则的地方: 数字定格时刻由既有的 `fps*0.6 + countDur` 这套
 * frame 数学决定, 不是新增的 anim 调用。数字定格的瞬间叠一下 `beatHit`(强调
 * "数到这了"), label 用 `fadeUp` 进场。
 */
export const Stat: React.FC<{
  slots: {label: string; value: number; prefix?: string; suffix?: string; note?: string};
  durationInFrames: number;
  theme: CardTheme;
  style?: ShotStyle;
}> = ({slots, durationInFrames, theme, style}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);
  const label = assertContent(slots.label, 'stat.label');
  const t = speedT(style);
  const accentColor = resolveAccent(style?.accent, theme.accent);
  const highlightColor = resolveAccent(style?.accent, theme.highlight);

  const countDur = Math.min(fps * 1.6, durationInFrames * 0.5);
  const p = interpolate(frame, [fps * 0.6, fps * 0.6 + countDur], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  // 本项目修改(2026-08-31)：取整不能一律 Math.round —— facts 台账里 32.2% 这类
  // 非整数 value，末帧定格若取整成 32 就和台账不再逐位一致(见 lib.tsx 的
  // roundToSourceDecimals 注释)。取整精度跟随 value 自身的小数位数。
  const shown = roundToSourceDecimals(p * slots.value, slots.value);

  // 数字定格的那一刻(既有的 frame 数学, 不经过 t() —— 见上方类注释): 换算成
  // 秒之后再喂给 beatHit, 让 beatHit 自己的 atSec 走 t(), 保证"所有 anim 调用
  // 的 atSec 走 t()"这条统一规则不留死角, 即便触发时机本身另有算法决定。
  const countEndSec = (fps * 0.6 + countDur) / fps;
  const beat = beatHit(frame, fps, t(countEndSec));
  const beatArriveAt = t(countEndSec) + 0.3;

  const labelFade = fadeUp(frame, fps, t(0));
  const labelArriveAt = t(0) + 0.5;

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
        ...scaleStyle(style),
      }}
    >
      <Live
        seed={1}
        from={labelArriveAt}
        style={{
          fontFamily: FONT_CN, fontSize: scaleFont(width, height, 34), color: accentColor, letterSpacing: '0.12em',
          ...labelFade,
        }}
      >
        {label}
      </Live>
      <Live
        seed={2}
        from={beatArriveAt}
        style={{
          fontFamily: FONT_CN, fontWeight: 900, color: highlightColor, marginTop: scaleFont(width, height, 16),
          fontSize: scaleFont(width, height, 170), lineHeight: 1.05,
          WebkitTextStroke: `${scaleFont(width, height, 6)}px ${theme.stroke}`, paintOrder: 'stroke',
          // value 是一串不含空格的数字, 默认 word-break 不会在数字中间断行——
          // 加 overflowWrap 让极端位数的数字至少能换行, 而不是顶着 overflow:hidden
          // 被整体裁掉看不全。仍然只是兜底: 位数一旦夸张, 观感必然变差, 但不会越界。
          maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word',
          ...beat,
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
