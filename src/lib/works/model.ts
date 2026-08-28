import { median, MIN_RETROS_FOR_MEDIAN } from '@/lib/settings/baseline-stats';

/**
 * 已发布作品(v5)—— 从抖音创作者后台回采的真实数据。
 *
 * 这批数据**不是校准样本**: 它们不是用这个系统写的, 没有预测分可以配对。它们是
 * **基线** —— 「你的账号在这个赛道上通常是什么表现」, 以后新发的片子跟它比。
 *
 * 为什么要按年份和主题筛: 用户的 101 条作品里 91 条 0 播放, 大部分是 2020-2023 年的
 * 生活向内容。全塞进基线会把它拽到一个和当前定位无关的分布上 —— 基线就失去意义了。
 */

/** 从这一年起的作品才进基线。之前账号不是这个方向。 */
export const BASELINE_YEAR_FROM = 2026;

/**
 * 标题看起来是不是当前赛道(AI / 工具)的内容。
 *
 * 只是**默认值**, 用户在界面上可以逐条改判 —— 「哪些作品算数」直接决定基线,
 * 不该由一个关键词表替用户拍板。
 */
const AI_KEYWORDS = [
  'ai', 'AI', '大模型', 'gpt', 'GPT', 'claude', 'Claude', 'deepseek', 'DeepSeek',
  'openclaw', 'opencalw', 'agent', 'Agent', '智能体', 'prompt', '提示词',
  'u盘', 'U盘', '龙虾', 'exe', '打包', '部署', '开源', 'github', 'GitHub',
  'codex', 'Codex', 'skill', 'coze', 'n8n', '工作流', '自动化',
];

export function looksAiRelated(title: string): boolean {
  const t = (title ?? '').trim();
  if (!t) return false;
  return AI_KEYWORDS.some((k) => t.includes(k));
}

export interface WorkLike {
  title: string;
  play: number;
  publishedAt: Date;
}

/** 默认是否计入基线: 够新 + 看起来是当前赛道。 */
export function shouldCountByDefault(w: WorkLike): boolean {
  return w.publishedAt.getUTCFullYear() >= BASELINE_YEAR_FROM && looksAiRelated(w.title);
}

export interface Baseline {
  count: number;
  /** 计入的作品播放中位数。少于 3 条时为 null —— 沿用既有 retro 基线的口径。 */
  median: number | null;
  max: number;
}

/**
 * 从计入的作品算基线。
 *
 * **0 播放的照样算进去**: 发出去没人看是真实表现的一部分, 只统计有播放的会把
 * 基线抬到一个你根本达不到的位置。
 */
export function buildBaseline(works: { play: number; counted: boolean }[]): Baseline {
  const plays = works.filter((w) => w.counted).map((w) => w.play);
  return {
    count: plays.length,
    median: plays.length >= MIN_RETROS_FOR_MEDIAN ? Math.round(median(plays) ?? 0) : null,
    max: plays.length > 0 ? Math.max(...plays) : 0,
  };
}
