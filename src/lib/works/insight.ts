import { median } from '@/lib/settings/baseline-stats';

/**
 * AI 类作品的文案 × 流量分析(v5)。
 *
 * 目标不是「算出一个分数」, 而是**给下一条视频一个可执行的假设**。所以这里所有
 * 输出都叫「假设」而不是「结论」, 并且强制带置信度 —— 用户当前只有 4 条 AI 类公开
 * 作品, 其中一条 25,096 播、另外三条 400 上下。这种分布看起来很有说服力, 恰恰是
 * 最容易骗人的: n=4 时一个爆款能让任何特征看起来都像成功因素。
 *
 * 系统的价值在于**每发一条就多一个样本**, 假设逐渐变成结论。所以宁可现在标 low,
 * 也不要给一个听起来笃定的建议。
 */

/** 两组各达到这个条数, 才敢把置信度往上抬一档。 */
export const CONFIDENT_SAMPLE = 12;

export interface CaptionFeatures {
  /** 文案里点明了「替谁解决了什么问题」。 */
  painPoint: boolean;
  hasNumber: boolean;
  hasQuestion: boolean;
  /** 第一人称叙事(我…)—— 经历型内容的标志。 */
  firstPerson: boolean;
  captionChars: number;
  hashtagCount: number;
}

/** 「解决了什么」的说法。不含「赚了多少」——那是结果, 不是别人的痛点。 */
const PAIN_PATTERNS = [
  /解决了?[^，。]{0,12}(痛点|问题|麻烦)/,
  /痛点/,
  /告别[^，。]{0,10}/,
  /不用(装|配|再)/,
  /无法(安装|访问|使用|打开)/,
  /卡在/,
  /省(掉|下)[^，。]{0,8}(时间|事)/,
  /(再也)?不(需要|必)/,
];

function countChars(text: string): number {
  return (text ?? '').replace(/[\s#＃]/g, '').length;
}

export function extractCaptionFeatures(caption: string, hashtags: string[] = []): CaptionFeatures {
  const t = (caption ?? '').trim();
  return {
    painPoint: PAIN_PATTERNS.some((p) => p.test(t)),
    hasNumber: /\d/.test(t),
    hasQuestion: /[?？]/.test(t),
    firstPerson: /^我|我的|我在|当我/.test(t),
    captionChars: countChars(t),
    hashtagCount: hashtags.length,
  };
}

export interface WorkLike {
  id: string;
  caption: string;
  hashtags: string[];
  play: number;
  digg: number;
  collect: number;
  durationSec: number;
  publishedAt: Date;
}

export type Confidence = 'low' | 'medium' | 'high';

export interface Hypothesis {
  key: string;
  label: string;
  withCount: number;
  withoutCount: number;
  withMedian: number;
  withoutMedian: number;
  /** 有这个特征的中位数是没有的多少倍。 */
  lift: number;
  confidence: Confidence;
}

interface FeatureDef {
  key: string;
  label: string;
  test: (w: WorkLike) => boolean;
}

const FEATURES: FeatureDef[] = [
  { key: 'painPoint', label: '文案点明了痛点', test: (w) => extractCaptionFeatures(w.caption, w.hashtags).painPoint },
  { key: 'short', label: '时长在 20 秒以内', test: (w) => w.durationSec > 0 && w.durationSec <= 20 },
  { key: 'hasNumber', label: '文案里有具体数字', test: (w) => extractCaptionFeatures(w.caption).hasNumber },
  { key: 'hasQuestion', label: '文案里有提问', test: (w) => extractCaptionFeatures(w.caption).hasQuestion },
  { key: 'hashtag', label: '带了话题标签', test: (w) => w.hashtags.length > 0 },
  { key: 'firstPerson', label: '第一人称开头', test: (w) => extractCaptionFeatures(w.caption).firstPerson },
];

function confidenceOf(a: number, b: number): Confidence {
  if (a >= CONFIDENT_SAMPLE && b >= CONFIDENT_SAMPLE) return 'high';
  if (a >= CONFIDENT_SAMPLE / 2 && b >= CONFIDENT_SAMPLE / 2) return 'medium';
  return 'low';
}

/**
 * 逐个特征做「有 vs 没有」的中位数对比。
 *
 * 某一组一条都没有时**不出这条假设** —— 没有对照就没有比较, 硬给一个数只会让人
 * 以为验证过了。按倍数差排序, 差距最大的最值得先去验证。
 */
export function buildHypotheses(works: WorkLike[]): Hypothesis[] {
  if (works.length < 2) return [];

  const out: Hypothesis[] = [];
  for (const f of FEATURES) {
    const withF = works.filter(f.test);
    const withoutF = works.filter((w) => !f.test(w));
    if (withF.length === 0 || withoutF.length === 0) continue;

    const wm = Math.round(median(withF.map((w) => w.play)) ?? 0);
    const om = Math.round(median(withoutF.map((w) => w.play)) ?? 0);
    out.push({
      key: f.key,
      label: f.label,
      withCount: withF.length,
      withoutCount: withoutF.length,
      withMedian: wm,
      withoutMedian: om,
      lift: om > 0 ? wm / om : wm > 0 ? Infinity : 1,
      confidence: confidenceOf(withF.length, withoutF.length),
    });
  }
  return out.sort((a, b) => b.lift - a.lift);
}

export interface Suggestion {
  text: string;
  why: string;
  confidence: Confidence;
}

export interface NextVideoAdvice {
  basedOn: number;
  caveat: string;
  /** 表现最好那条的时长 —— 取标杆而不是平均, 平均会被长视频拖歪。 */
  bestDurationSec: number | null;
  suggestions: Suggestion[];
}

/**
 * 下一条该怎么做。
 *
 * 建议来自假设, 所以每条都带着它的置信度一起给 —— 用户有权知道哪条是「数据这么
 * 说」哪条是「只有一个样本这么说」。
 */
export function adviseNextVideo(works: WorkLike[]): NextVideoAdvice {
  if (works.length === 0) {
    return {
      basedOn: 0,
      caveat: '还没有可分析的 AI 类公开作品。发一条并回采之后，这里才有东西可说。',
      bestDurationSec: null,
      suggestions: [],
    };
  }

  const hypotheses = buildHypotheses(works);
  const best = [...works].sort((a, b) => b.play - a.play)[0];

  const suggestions: Suggestion[] = hypotheses
    .filter((h) => h.lift > 1.5)
    .slice(0, 4)
    .map((h) => ({
      text: `下一条试试：${h.label}`,
      why: `有这个特征的 ${h.withCount} 条中位数 ${h.withMedian.toLocaleString()} 播，没有的 ${h.withoutCount} 条是 ${h.withoutMedian.toLocaleString()} 播`,
      confidence: h.confidence,
    }));

  if (best.durationSec > 0) {
    suggestions.push({
      text: `时长按 ${best.durationSec} 秒的量级做`,
      why: `目前播放最高的一条(${best.play.toLocaleString()} 播)就是 ${best.durationSec} 秒`,
      confidence: works.length >= CONFIDENT_SAMPLE ? 'medium' : 'low',
    });
  }

  const lowSample = works.length < CONFIDENT_SAMPLE;
  return {
    basedOn: works.length,
    caveat: lowSample
      ? `只有 ${works.length} 条 AI 类公开作品，下面全部是假设、不是结论——样本这么少时，一条爆款会让任何特征看起来都像成功因素。每发一条就多一个样本，假设才会慢慢变成结论。`
      : `基于 ${works.length} 条 AI 类公开作品。`,
    bestDurationSec: best.durationSec > 0 ? best.durationSec : null,
    suggestions,
  };
}
