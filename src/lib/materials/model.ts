/**
 * 素材库(v5 阶段 D1)。
 *
 * 存在的理由: 六幕稿写到需要具体材料的地方, 没有素材 AI 就会开始编 —— 这是当前
 * 最大的失真来源。素材不是「资料收藏」, 它是写稿时的**约束**: 手里有什么才能写
 * 什么, 没有就别硬写。
 */

export const MATERIAL_KINDS = ['quote', 'data', 'story', 'punchline', 'experience'] as const;

export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const MATERIAL_LABELS: Record<MaterialKind, string> = {
  quote: '书摘',
  data: '数据',
  story: '故事',
  punchline: '金句',
  experience: '亲身经历',
};

/** 每一类为什么值得单独记。展示在素材库页, 也用来解释缺口。 */
export const MATERIAL_WHY: Record<MaterialKind, string> = {
  quote: '有出处的原文。转述会失真, 原文才经得起追问。',
  data: '具体数字 + 出处。没有出处的数字不如不写 —— 说错了要掉粉。',
  story: '别人的完整事例, 用来打比方。',
  punchline: '一句话说清一个道理, 收尾用。',
  experience: '只有你自己经历过的细节。这是账号差异化的唯一来源 —— 其余四类 AI 自己也查得到。',
};

export function isMaterialKind(v: unknown): v is MaterialKind {
  return typeof v === 'string' && (MATERIAL_KINDS as readonly string[]).includes(v);
}

export interface MaterialLike {
  id: string;
  kind: string;
  content: string;
  source: string;
  tags: string[];
}

/** 单字不算关键词 —— 「的」「了」会把整个库都捞出来。 */
const MIN_KEYWORD_LEN = 2;

function tokensOf(input: { narration: string; beats: string[] }): string[] {
  const fromBeats = input.beats.filter((b) => b.length >= MIN_KEYWORD_LEN);
  // 旁白按标点切成词组, 太短的丢掉
  const fromNarration = (input.narration ?? '')
    .split(/[，。、；：！？,.;:!?—…\s""''「」《》()（）]+/)
    .filter((w) => w.length >= MIN_KEYWORD_LEN);
  return Array.from(new Set([...fromBeats, ...fromNarration]));
}

/**
 * 按当前幕检索素材。
 *
 * **双向匹配**, 缺一个方向都会漏:
 * - 素材的 tag 出现在这一幕的文字里(「互惠」出现在「互惠原理是怎么起作用的」)
 * - 这一幕的词出现在素材正文里(关键词「试吃」出现在某条素材的内容中)
 *
 * 只做单向(把整幕文字拿去 includes 素材内容)会一条都匹配不上, 因为中文旁白
 * 按标点切出来的是长词组, 不是词。
 *
 * 命中数多的排前面。**一条都没命中就返回空数组**, 不硬塞几条充数: 塞进来的
 * 无关素材会诱导你把它写进稿子, 那比没有素材更糟。
 */
export function matchMaterials<T extends MaterialLike>(
  materials: T[],
  act: { narration: string; beats: string[] },
): T[] {
  const tokens = tokensOf(act);
  if (tokens.length === 0) return [];
  const actText = `${act.narration} ${act.beats.join(' ')}`;

  return materials
    .map((m) => {
      const tagHits = m.tags.filter((t) => t.length >= MIN_KEYWORD_LEN && actText.includes(t)).length;
      const tokenHits = tokens.filter((k) => m.content.includes(k)).length;
      return { m, hits: tagHits + tokenHits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((x) => x.m);
}

export interface MaterialGap {
  kind: MaterialKind;
  label: string;
  count: number;
  why: string;
}

/**
 * 各类素材的分布, 按数量升序 —— 最缺的排最前。
 *
 * 数量并列时**亲身经历排在最前**: 其余四类 AI 自己也能查, 只有它是不可替代的,
 * 所以同样是 0 条, 缺它比缺书摘严重得多。
 *
 * 五类全返回而不是只报警: 这一栏要回答的是「我手里有什么」, 分布本身就是信息。
 */
const GAP_PRIORITY: Record<MaterialKind, number> = {
  experience: 0, story: 1, data: 2, quote: 3, punchline: 4,
};

export function materialGaps(materials: MaterialLike[]): MaterialGap[] {
  return MATERIAL_KINDS.map((kind) => ({
    kind,
    label: MATERIAL_LABELS[kind],
    count: materials.filter((m) => m.kind === kind).length,
    why: MATERIAL_WHY[kind],
  })).sort((a, b) => a.count - b.count || GAP_PRIORITY[a.kind] - GAP_PRIORITY[b.kind]);
}
