import type React from 'react';
import {CardTheme} from '../theme';

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
 * 模型不填这个字段)画面就会平白变了样, 破坏向后兼容。
 *
 * 显式传 `blue`/`yellow`/`red` 时, **从 `theme.accents` 取, 不直接碰
 * `motion/lib.tsx` 的 `C`**(复审补修, 见 `theme.ts` 的 `CardTheme.accents`
 * 注释)——spec §4.1 的要求是"限定在主题 token 内, 保证不跑出设计系统"。
 * `illustration` 主题的 `accent` 字段本来就用柔化过的 `C.lightBlue` 而不是
 * `C.blue`, 是刻意避免鲜蓝出现在暖纸背景上; 如果这里直接返回全局 `C.blue`,
 * 用户在 illustration 主题下选"蓝"反而会跳出该主题的色系, 与"限定在主题
 * token 内"这条约束正面冲突。所以 `resolveAccent` 必须接收当前卡的 `theme`,
 * 让同一个 `accent` 取值在不同 `visualStyle` 下解析出不同(但都在各自主题
 * 色系内)的颜色。
 */
export const resolveAccent = (
  accent: ShotStyle['accent'] | undefined,
  theme: CardTheme,
  fallback: string,
): string => {
  switch (accent) {
    case 'blue':
      return theme.accents.blue;
    case 'yellow':
      return theme.accents.yellow;
    case 'red':
      return theme.accents.red;
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

/** 剔除值为 undefined 的键 —— {...a, ...b} 里 b 的 undefined 键**存在**时会覆盖 a, 直接展开是错的。 */
const compact = (s?: ShotStyle | null): Partial<ShotStyle> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s ?? {})) if (v !== undefined) out[k] = v;
  return out as Partial<ShotStyle>;
};

/**
 * 模板默认样式与逐镜覆盖的合并(三十六期)。逐字段: 镜上显式设置的字段优先,
 * 没设的用模板默认。**唯一合并点** —— Film.tsx 渲卡前调它, 剪辑台面板显示
 * "跟随模板(当前:×)"也调它, 两处永远一致。
 */
export const mergeShotStyle = (
  templateStyle?: ShotStyle | null, shotStyle?: ShotStyle | null,
): ShotStyle => ({ ...compact(templateStyle), ...compact(shotStyle) });
