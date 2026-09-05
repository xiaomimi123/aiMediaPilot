import type React from 'react';
import {C} from '../motion/lib';

/**
 * 卡片消费的 style 参数(三十二期 Task 3)。
 *
 * 与 `src/lib/video-production/shot-plan.ts` 的 `ShotStyleSchema` 逐字段
 * 同形——**不 import**(`remotion/` 是独立子项目, 主项目 tsc 编译不到它,
 * 理由同 `Film.tsx` 里 `CaptionItem`/`sourceVideo` 的先例)。四张卡都从这里
 * 引入, 保证同一套规则只写一份、不各卡各抄一遍。
 */
export type ShotStyle = {
  speed?: number;
  accent?: 'default' | 'blue' | 'yellow' | 'red';
  scale?: number;
};

/**
 * `speed` → 时间函数 `t`。卡片内所有 anim 调用的 `atSec` 都要先过一遍 `t`。
 *
 * 注意这只把"进场动效什么时候起播"按 speed 缩放, **不改动 anim.ts 内部写死的
 * 动效时长**(比如 smashIn 的 0.42s)——那些时长是手法的一部分, Task 3 的
 * 需求也只要求缩放 atSec, 没有要求连带拉伸时长(见 task-3-brief.md)。
 * `speed` 只影响动效节奏, 不影响卡片显示时长(时长由 shot 的 startMs/endMs 定)。
 */
export const speedT = (style: ShotStyle | undefined) => {
  const speed = style?.speed ?? 1;
  return (sec: number) => sec / speed;
};

/**
 * `accent` → 具体颜色。`'default'`(含未传)保留调用方传入的 `fallback`——
 * 也就是这张卡这个位置原本该用的颜色(`theme.accent` 或 `theme.highlight`,
 * 两个角色默认色不同), 不强行统一成一个颜色, 否则不传 style 的分镜(绝大多数,
 * 模型不填这个字段)画面就会平白变了样, 破坏向后兼容。只有显式传
 * `blue`/`yellow`/`red` 时才用 `motion/lib.tsx` 的 `C` 覆盖。
 */
export const resolveAccent = (
  accent: ShotStyle['accent'] | undefined,
  fallback: string,
): string => {
  switch (accent) {
    case 'blue':
      return C.blue;
    case 'yellow':
      return C.yellow;
    case 'red':
      return C.red;
    default:
      return fallback;
  }
};

/**
 * `scale` → 外层容器的 `transform`。整张卡套一层 `scale(N)`,
 * `transformOrigin: 'center'`。`scale` 缺省或恰好是 1 时不写 `transform`,
 * 避免给每一帧都加一条空操作的 CSS 属性。
 */
export const scaleStyle = (style: ShotStyle | undefined): React.CSSProperties => {
  const scale = style?.scale ?? 1;
  if (scale === 1) return {};
  return {transform: `scale(${scale})`, transformOrigin: 'center'};
};
