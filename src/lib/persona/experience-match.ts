import type { ExperienceItem } from './voice';

/**
 * 经历检索 —— 纯函数, 零 IO, 零 LLM 调用。
 *
 * 十二期刻意不做向量检索: 关键词交集对个人经历库 (几十条量级) 足够, 且可单测调参;
 * 库涨到几百条再议 (spec §0)。
 *
 * 匹配不准的兜底不在这里, 而在写稿 prompt 的护栏句 (「不相关就别用, 不要硬凑」) ——
 * 检索只负责给候选, 用不用由写稿模型判断。
 */

/** 分词: 按空白与常见中英文标点切分, 去空串。 */
function tokenize(text: string): string[] {
  return text
    .split(/[\s,，。、;；:：!！?？"'“”‘’()（）\[\]【】<>《》/\\|~`@#$%^&*+=_-]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

/** 一条经历的可匹配词集合 = keywords ∪ [topic]; 统一小写去空白。 */
function itemTerms(item: ExperienceItem): string[] {
  const terms = [...item.keywords, item.topic];
  return terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
}

/**
 * 命中数 = 「主题分词 + 主题整串」与「条目词集合」的双向包含匹配数。
 *
 * 双向包含而非严格相等: 主题「AI 工具提效」的分词是 ["ai","工具提效"], 条目关键词
 * 可能是「效率工具」——严格相等会漏掉大量真实场景。用 includes 双向判断可以接住
 * 中文不分词带来的粒度差异。代价是可能多召回, 由 limit 截断 + prompt 护栏兜住。
 */
function hitCount(topic: string, item: ExperienceItem): number {
  const queries = [...tokenize(topic), topic.trim().toLowerCase()].filter((q) => q.length > 0);
  const terms = itemTerms(item);
  if (queries.length === 0 || terms.length === 0) return 0;
  let hits = 0;
  for (const term of terms) {
    const matched = queries.some((q) => q.includes(term) || term.includes(q));
    if (matched) hits += 1;
  }
  return hits;
}

/**
 * 按主题检索最相关的经历。
 *
 * 排序: 命中数降序 → createdAt 降序 (同等相关时优先用新的经历)。
 * 命中数为 0 的条目直接排除 —— 宁可不给, 不给不相关的。
 */
export function matchExperiences(
  topic: string,
  items: ExperienceItem[],
  limit = 3,
): ExperienceItem[] {
  if (!topic.trim() || items.length === 0 || limit <= 0) return [];
  const scored = items
    .map((item) => ({ item, hits: hitCount(topic, item) }))
    .filter((s) => s.hits > 0);
  scored.sort((a, b) => {
    if (b.hits !== a.hits) return b.hits - a.hits;
    return b.item.createdAt.localeCompare(a.item.createdAt);
  });
  return scored.slice(0, limit).map((s) => s.item);
}
