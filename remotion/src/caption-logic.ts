import type {CaptionItem} from './Film';

/**
 * "当前该显示哪一句"的选择逻辑抽成独立、不依赖 remotion 包的纯函数。
 *
 * 单独放一个文件(而不是留在 `Captions.tsx` 里)是为了让主项目的
 * vitest 能直接 `import` 这个函数做单测: `Captions.tsx` 顶部有
 * `import {useCurrentFrame, useVideoConfig} from 'remotion'`——这是运行时
 * 值导入, `remotion` 包只装在 `remotion/node_modules` 里, 主项目
 * `node_modules` 里没有, 直接 import `Captions.tsx` 会在测试里炸掉模块解析。
 * 这个文件只 `import type` `CaptionItem`(类型导入会被 esbuild 整行擦除,
 * 不产生运行时 import), 不引入任何 remotion 包依赖, 可以被两边安全共用。
 *
 * 半开区间 `[startMs, endMs)`——与 SRT/ASS 字幕的边界习惯一致, 避免同一
 * 时间点(上一句的 endMs === 下一句的 startMs)两句同时命中。
 */
export function pickCurrentCaption(items: CaptionItem[], nowMs: number): CaptionItem | undefined {
  return items.find((c) => nowMs >= c.startMs && nowMs < c.endMs);
}
