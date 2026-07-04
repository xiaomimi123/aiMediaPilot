import { KNOWN_NICHES } from './llm/prompts/expert-persona';

/**
 * 把用户输入的 niche 归一化成 canonical key。
 *
 * 规则 (按优先级):
 *  1. trim + 小写 + 折叠空白后, 精确 hit KNOWN_NICHES.key → 用它
 *  2. 精确 hit KNOWN_NICHES.label → 反查 key
 *  3. 都不 hit → 归一化后的字符串本身
 *
 * 之前的问题: `/api/v1/discover/topics` 的 dedup 用 `niche` 原样精确匹配 scriptDraft
 * 的 niche 字段。 用户输入 "AI-知识" vs "ai-knowledge" 或多敲个空格, 就绕开了 dedup,
 * 每次都被喂重复选题。 加归一化后, 相似输入 collapse 到同一 canonical key。
 */
export function normalizeNiche(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const lowered = trimmed.toLowerCase();

  // 1. key 精确匹配
  const byKey = KNOWN_NICHES.find((n) => n.key.toLowerCase() === lowered);
  if (byKey) return byKey.key;

  // 2. label 匹配 (label 一般是中文, 不 lowercase 也无所谓;
  //    但保底 lowercase 对比防止 "AI 知识" vs "ai 知识" 之类)
  const byLabel = KNOWN_NICHES.find((n) => n.label.toLowerCase() === lowered);
  if (byLabel) return byLabel.key;

  return lowered;
}
