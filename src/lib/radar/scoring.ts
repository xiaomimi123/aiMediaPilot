import { createHash } from 'crypto';

/**
 * 热点雷达 — 热度合成纯函数核心。
 *
 * 零 IO: 不 import prisma / fetch / llm。供 worker (T4 采集管线) 与展示层
 * (applyTimeDecay 渲染时叠加) 复用，且可脱离数据库/网络完整单测覆盖。
 * 权重/常量集中放在 HEAT_WEIGHTS，调参只改这一处。
 */

export const HEAT_WEIGHTS = {
  // composeHeat 四维加权 (需求文档口径，四者之和 = 1)
  relevance: 0.35,
  freshness: 0.2,
  discussion: 0.25,
  feasibility: 0.2,
  // 共现加成: 同簇每多 1 个来源 +8 分，封顶 +24 (即最多计 3 个额外来源)
  cooccurrencePerSource: 8,
  cooccurrenceCap: 24,
  // clusterByTopic 判同簇的关键词 Jaccard 阈值 (≥ 视为同簇)
  clusterJaccardThreshold: 0.6,
  // applyTimeDecay: 每满 24h 扣分数，下限为原分的比例
  decayPerDayPoints: 8,
  decayFloorRatio: 0.3,
} as const;

export interface ReadScores {
  relevance: number;
  freshness: number;
  discussion: number;
  feasibility: number;
}

/**
 * 标题指纹 — 规范化 (NFKC 折叠全半角 + 小写 + 去空白/标点/符号) 后取 sha1 hex。
 * 用途: RadarItem 去重 (titleHash 字段) 与 clusterByTopic 同簇判定 (指纹相同即同簇)。
 *
 * NFKC 会把全角字母/数字/标点折叠为对应半角形式 (如 "Ａ"→"A", "２"→"2", "，"→",")，
 * 再统一转小写、剥离空白/标点/符号类字符，避免同一篇报道在不同站点因排版差异
 * (全角/半角、标点、空格) 被误判为不同标题。
 */
export function titleFingerprint(title: string): string {
  const normalized = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
  return createHash('sha1').update(normalized).digest('hex');
}

export interface ClusterableItem {
  titleFingerprint: string;
  matchedKeywords: string[];
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0; // 两边都是空集 → 视为不相似，不因"都没词"而误判同簇
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  return intersection / union.size;
}

/**
 * 按 "标题指纹相同" 或 "命中关键词集合 Jaccard ≥ 阈值" 判同簇 (并查集合并，具传递性)。
 * 保留原始 item 引用 (调用方可附加 id/url 等额外字段)，按元素首次出现顺序分组返回。
 */
export function clusterByTopic<T extends ClusterableItem>(items: T[]): T[][] {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sameFingerprint = items[i].titleFingerprint === items[j].titleFingerprint;
      const similarKeywords =
        jaccard(items[i].matchedKeywords, items[j].matchedKeywords) >=
        HEAT_WEIGHTS.clusterJaccardThreshold;
      if (sameFingerprint || similarKeywords) union(i, j);
    }
  }

  const groups = new Map<number, T[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(items[i]);
    else groups.set(root, [items[i]]);
  }
  return [...groups.values()];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 四维加权 + 共现加成 → 0-100 整数热度分。
 * cooccurrenceSources: 同簇内除自身外的其他来源数
 * (典型取值 = clusterByTopic 返回的对应簇 length - 1)。
 */
export function composeHeat(read: ReadScores, cooccurrenceSources: number): number {
  const base =
    read.relevance * HEAT_WEIGHTS.relevance +
    read.freshness * HEAT_WEIGHTS.freshness +
    read.discussion * HEAT_WEIGHTS.discussion +
    read.feasibility * HEAT_WEIGHTS.feasibility;
  const bonus = Math.min(
    Math.max(cooccurrenceSources, 0) * HEAT_WEIGHTS.cooccurrencePerSource,
    HEAT_WEIGHTS.cooccurrenceCap
  );
  return Math.round(clamp(base + bonus, 0, 100));
}

/**
 * 展示层时间衰减 (纯函数，不改库内 heatScore，仅列表渲染时叠加计算)。
 * 每满 24h 扣 decayPerDayPoints 分，下限为原分的 decayFloorRatio 比例，最终 floor 到 Int。
 */
export function applyTimeDecay(score: number, collectedAt: Date, now: Date): number {
  const hoursElapsed = Math.max(0, (now.getTime() - collectedAt.getTime()) / (1000 * 60 * 60));
  const periods = Math.floor(hoursElapsed / 24);
  const decayed = score - periods * HEAT_WEIGHTS.decayPerDayPoints;
  const floor = score * HEAT_WEIGHTS.decayFloorRatio;
  return Math.floor(Math.max(decayed, floor));
}
