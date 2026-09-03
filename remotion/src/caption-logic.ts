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

/**
 * 逐词高亮(二十九期 Task 5)。
 *
 * `Captions.tsx` 只显示整句字幕(`current.text`), 但字级对齐产出的
 * `current.words` 是一组"这段原文对应哪段时间"的词条, 词条文本(`word`)
 * 未必逐字符覆盖 `text` 的每一个位置(标点被跳过, 数字/百分比/区间/年份
 * 合并成一个词)。要把"当前该高亮哪个词"渲染成整句里的一段, 需要先把整句
 * 拆成"普通文字段"和"词段"交替的一串片段——同一个词条的文本在 `text`
 * 里的出现位置用**顺序查找**(从上一个词条结束的位置往后找)确定, 而不是
 * 独立对每个词条做全文搜索: 词条本身就是按 `text` 从左到右的顺序产出的
 * (`align-captions.ts` 的 `mapSegmentsToWords` 保证), 顺序查找既能找到
 * 正确的出现位置(数字这类词条文本可能在整句里重复出现, 比如两次提到同一个
 * 数字), 又是线性时间。
 *
 * 找不到某个词条文本(理论上不该发生, 防御性处理)时跳过该词条, 不打断
 * 整句拼接——宁可这个词不能高亮, 也不能因为一个词条异常丢字。
 */
export interface CaptionChunk {
  text: string;
  /** 这段文字是否对应一个词条(可高亮); 为 `undefined` 表示普通文字段。 */
  word?: {startMs: number; endMs: number};
}

export function splitCaptionIntoChunks(
  text: string,
  words: {word: string; startMs: number; endMs: number}[] | undefined,
): CaptionChunk[] {
  if (!words || words.length === 0) return [{text}];

  const chunks: CaptionChunk[] = [];
  let cursor = 0;
  for (const w of words) {
    const idx = text.indexOf(w.word, cursor);
    if (idx === -1) continue; // 防御性: 词条文本在剩余原文里找不到, 跳过不打断
    if (idx > cursor) chunks.push({text: text.slice(cursor, idx)});
    chunks.push({text: w.word, word: {startMs: w.startMs, endMs: w.endMs}});
    cursor = idx + w.word.length;
  }
  if (cursor < text.length) chunks.push({text: text.slice(cursor)});
  return chunks;
}

/** 当前时刻落在哪个词条区间内(左闭右开, 与 `pickCurrentCaption` 同惯例)。 */
export function isWordActive(word: {startMs: number; endMs: number} | undefined, nowMs: number): boolean {
  if (!word) return false;
  return nowMs >= word.startMs && nowMs < word.endMs;
}
