/**
 * 钩子库(v5 阶段 D2)。
 *
 * **和设计稿的一处故意不同**: 设计稿在这一页显示「预测留存 %」并按它排序。
 * 那个数字现在编不出来 —— 发布 0 条, 没有任何真实留存可以拟合, 所谓预测就是
 * 模型的臆测披上百分号。这里改成**结构分**: 只算能量的东西(字数、人称、书名号、
 * 是否有数字或问号), 并在页面上明说它**预测不了留存**。
 *
 * 等中回路(发布 → 回采)通了, 再用真实完播率替换排序依据。在那之前, 一个诚实的
 * 结构分比一个假的百分比有用得多。
 */

export const HOOK_PATTERNS = [
  'number',
  'question',
  'counter',
  'scene',
  'contrast',
  'other',
] as const;

export type HookPattern = (typeof HOOK_PATTERNS)[number];

export const HOOK_LABELS: Record<HookPattern, string> = {
  number: '数字冲击',
  question: '悬念提问',
  counter: '反常识断言',
  scene: '场景代入',
  contrast: '身份反差',
  other: '其它',
};

/** 钩子的字数预算。超过就在 6 秒的开场里讲不完, 会挤压后面的概念幕。 */
export const HOOK_CHAR_BUDGET = 22;

function countChars(text: string): number {
  return (text ?? '').replace(/[\s，。、；：！？,.;:!?—…""''「」《》()（）]/g, '').length;
}

/**
 * 认模式。认不出来就归「其它」—— 硬套一个模式会让后面的模式统计变成噪音。
 *
 * 判定顺序是有意的:
 * - 场景代入的「你在…」比问号更能说明写法, 所以排最前
 * - 问号排在数字之前:「一个 skill 一周卖七十个」开头的「一个」是量词而非数量主张
 * - 单独的「一」不算数字开头, 同上
 */
export function detectHookPattern(text: string): HookPattern {
  const t = (text ?? '').trim();
  if (!t) return 'other';
  if (/^你在.{0,12}(时|的时候|吗)|^你.{0,6}过/.test(t)) return 'scene';
  if (/其实不是|并不是|恰恰相反|反而|你以为/.test(t)) return 'counter';
  // 问号优先于数字: 「一个 skill 一周卖七十个, 它是怎么做到的?」里的「一个」是量词
  // 不是数量主张, 判成数字冲击会让模式统计失真
  if (/[?？]\s*$/.test(t)) return 'question';
  if (/^[\d二三四五六七八九十百千万]/.test(t) || /\d/.test(t.slice(0, 10))) return 'number';
  if (/我这样的|像我这种|一个.{0,6}(小白|新手|外行)/.test(t)) return 'contrast';
  return 'other';
}

export interface HookStructureScore {
  total: number;
  max: number;
  /** 每一条加减分的理由, 直接展示 —— 只给分不说为什么等于没评。 */
  notes: string[];
}

/**
 * 钩子的结构分。**刻意不返回任何留存率预测** —— 没有发布数据就编不出那个数,
 * 编出来只会让人按一个假信号排序。
 */
export function scoreHookStructure(text: string): HookStructureScore {
  const t = (text ?? '').trim();
  const chars = countChars(t);
  const notes: string[] = [];
  let total = 0;
  const max = 4;

  if (chars > 0 && chars <= HOOK_CHAR_BUDGET) {
    total += 1;
  } else if (chars > HOOK_CHAR_BUDGET) {
    notes.push(`${chars} 字，超过 ${HOOK_CHAR_BUDGET} 字预算，6 秒开场里讲不完`);
  }

  if (/^你/.test(t)) {
    total += 1;
  } else if (t) {
    notes.push('不是第二人称开头，观众代入慢半拍');
  }

  if (/[《》]/.test(t)) {
    notes.push('钩子里出现书名——先讲现象再点书，否则前 3 秒就把人筛掉了');
  } else if (t) {
    total += 1;
  }

  if (/\d/.test(t) || /[?？]/.test(t)) {
    total += 1;
  } else if (t) {
    notes.push('既没有具体数字也没有提问，前 3 秒缺一个抓手');
  }

  return { total, max, notes };
}

export interface HookHint {
  key: 'secondPerson' | 'overBudget' | 'bookTitle';
  text: string;
  matched: number;
  total: number;
  /** 样本太少, 这条归纳不作数。 */
  underpowered: boolean;
}

/** 少于这个条数就不足以归纳规律。 */
const MIN_SAMPLE = 20;

/**
 * 从**你自己的钩子**里归纳结构规律。
 *
 * 不是通用写作建议 —— 是对这一库钩子的统计。样本不够时如实标 underpowered:
 * 4 条里 2 条第二人称, 说明不了任何事。
 */
export function hookStructureHints(hooks: { text: string; pattern: string }[]): HookHint[] {
  if (hooks.length === 0) return [];
  const total = hooks.length;
  const underpowered = total < MIN_SAMPLE;

  return [
    {
      key: 'secondPerson' as const,
      text: '以「你」开头',
      matched: hooks.filter((h) => /^你/.test(h.text.trim())).length,
      total,
      underpowered,
    },
    {
      key: 'overBudget' as const,
      text: `超过 ${HOOK_CHAR_BUDGET} 字`,
      matched: hooks.filter((h) => countChars(h.text) > HOOK_CHAR_BUDGET).length,
      total,
      underpowered,
    },
    {
      key: 'bookTitle' as const,
      text: '钩子里带书名',
      matched: hooks.filter((h) => /[《》]/.test(h.text)).length,
      total,
      underpowered,
    },
  ];
}
