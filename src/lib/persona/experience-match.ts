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

/** 是否为纯 ASCII 词 (英文/数字/工具名) —— 中英文匹配策略不同, 见 hitCount。 */
function isAscii(text: string): boolean {
  return /^[\x00-\x7F]+$/.test(text);
}

/**
 * 单个词是否命中主题。
 *
 * **中文不分词是这里最大的坑**: 真实数据里主题是「为什么很多人用AI效率没提升——你可能
 * 一直在用错的方式提问」, 经历关键词是「提问技巧」。二者互不包含 (关键词不是主题的子串,
 * 主题也不是关键词的子串), 纯 includes 匹配会 0 命中 —— 十二期收尾 E2E 真实复现过, 整个
 * 经历库因此形同虚设。
 *
 * 所以中文词改用 **2 字滑窗**: 只要关键词的任意连续 2 字出现在主题里就算命中
 * (「提问技巧」→ 含「提问」→ 命中)。2 字是中文最小语义单位, 再短 (单字) 会过度召回。
 * 过度召回的兜底不在这里, 而在 limit 截断 + 写稿 prompt 的「不相关就别用」护栏。
 *
 * ASCII 词 (如 "Claude"/"GPT"/"AI") 走**词边界**匹配而非子串 —— 子串会让 "AI" 命中
 * "detail"/"maintain" (E2E 中真实误伤过)。中文字符在 JS 正则里算非单词字符, 所以
 * "用AI效率" 里的 AI 两侧仍有词边界, 中英混排主题不受影响。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termHits(queries: string[], haystack: string, term: string): boolean {
  if (isAscii(term)) {
    return new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(haystack);
  }
  if (term.length <= 2) return haystack.includes(term);
  for (let i = 0; i + 2 <= term.length; i += 1) {
    if (haystack.includes(term.slice(i, i + 2))) return true;
  }
  return false;
}

/** 命中数 = 条目词集合里有多少个词命中了主题。 */
function hitCount(topic: string, item: ExperienceItem): number {
  const haystack = topic.trim().toLowerCase();
  const queries = [...tokenize(topic), haystack].filter((q) => q.length > 0);
  const terms = itemTerms(item);
  if (queries.length === 0 || terms.length === 0) return 0;
  let hits = 0;
  for (const term of terms) {
    if (termHits(queries, haystack, term)) hits += 1;
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
