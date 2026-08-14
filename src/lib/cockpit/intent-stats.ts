import type { ContentIntent } from './model';

/** `computeIntentMix` 消费者只需要 `intent` 一个字段——独立于 `ContentItem` 整个形状,
 * 方便测试直接构造最小对象，也方便未来任何持有 intent 的集合复用。 */
export interface IntentTagged {
  intent: ContentIntent;
}

export interface IntentMix {
  /** 百分比 (0-100 整数), 分母为 `total` (含未标注) */
  reach: number;
  trust: number;
  convert: number;
  /** 未标注条目数 (不是百分比——看板展示走「N 条」, 不走 %) */
  untagged: number;
  total: number;
}

const INTENT_KEYS = ['reach', 'trust', 'convert'] as const;

/**
 * 内容组合比例 (十期 T6, spec §3) —— 「引流 X% / 信任 Y% / 转化 Z% / 未标注 N 条」
 * 的纯函数统计。百分比分母统一取 `total`（含未标注), 未标注不显示百分比只显示条数,
 * 但它在整块占比里仍然要被扣掉，天然保证 reach/trust/convert 三者之和 ≤ 100。
 *
 * 取整用最大余数法 (Hamilton apportionment)，理由与推导见本文件同名测试
 * (tests/lib/cockpit/intent-stats.test.ts) 顶部注释——各自独立 `Math.round`
 * 三个百分比可能让三者之和超过 100 (例如 3/2/2 分 7 份 → 43/29/29=101),
 * 这里改为「先定一个 ≤100 的目标总量，再按小数部分从大到小分配整数名额」,
 * 数学上保证结果之和恒等于目标总量、不会超过 100。
 */
export function computeIntentMix(items: IntentTagged[]): IntentMix {
  const total = items.length;
  if (total === 0) return { reach: 0, trust: 0, convert: 0, untagged: 0, total: 0 };

  const counts: Record<(typeof INTENT_KEYS)[number], number> = { reach: 0, trust: 0, convert: 0 };
  let untagged = 0;
  for (const item of items) {
    if (item.intent === 'reach' || item.intent === 'trust' || item.intent === 'convert') {
      counts[item.intent] += 1;
    } else {
      untagged += 1;
    }
  }
  const taggedCount = total - untagged;

  // 目标总量：已标注条目占 total 的百分比整体四舍五入一次 (而不是三个类别各自
  // 四舍五入)，天然 ≤ 100。
  const targetSum = Math.round((taggedCount / total) * 100);

  const exact = Object.fromEntries(INTENT_KEYS.map((key) => [key, (counts[key] / total) * 100])) as Record<
    (typeof INTENT_KEYS)[number],
    number
  >;
  const floors = Object.fromEntries(INTENT_KEYS.map((key) => [key, Math.floor(exact[key])])) as Record<
    (typeof INTENT_KEYS)[number],
    number
  >;
  const floorSum = INTENT_KEYS.reduce((sum, key) => sum + floors[key], 0);
  const remainder = targetSum - floorSum; // 数学上恒 ∈ [0, 3]，见文件头注释推导

  const byRemainderDesc = [...INTENT_KEYS].sort((a, b) => exact[b] - floors[b] - (exact[a] - floors[a]));
  const result = { ...floors };
  for (let i = 0; i < remainder && i < byRemainderDesc.length; i += 1) {
    result[byRemainderDesc[i]] += 1;
  }

  return { reach: result.reach, trust: result.trust, convert: result.convert, untagged, total };
}
