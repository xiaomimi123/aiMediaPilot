import { scoreHardDimensions, type ScorableAct } from '@/lib/cockpit/script-score';
import { ACT_KEYS, ACT_LABELS, type ActKey } from './six-act';
import { diagnoseSentences } from './sentence-diagnosis';
import { estimateSpokenSec } from './act-plan';

/**
 * 离满分还差什么, 按「能不能靠改台词拿回来」分成两堆(二十三期)。
 *
 * **动因是一处自相矛盾。** 用户问: 评分说我丢了 14 分, 对照版却说这一幕「不用改」——
 * 既然有评分标准, 为什么不直接给我一份能拿满分的写法? 他是对的: 评分和对照是两套
 * 互不认识的东西, 对照的 prompt 里根本没有评分这回事。
 *
 * 但「照着评分改就能满分」这个想法里有一半是错的, 也必须说清楚:
 *
 * - **写法类**(垫话、超时、结尾只对同行、信任声明太靠后): 改台词能拿回来, 这些
 *   应该喂给对照版, 让它的改写朝着这几条去。
 * - **填字段类**(某一幕没写画面说明、没有关键词): 丢的是幕结构那 2 分, 但它跟台词
 *   一个字关系都没有 —— 台词改到天上去也拿不到。把它混在一起说「照这个改能满分」
 *   就是在骗人, 所以单独列, 并且明说要去填哪一栏。
 *
 * 分完之后对照版才有可能名副其实: 有丢分的幕不许再说「不用改」。
 */

export interface ScoreGaps {
  /** 能靠改台词拿回来的, 按幕归位。 */
  byAct: Partial<Record<string, string[]>>;
  /** 改台词永远拿不到的 —— 要去填画面/关键词那几栏。 */
  mechanical: string[];
}

/** 超出目标多少算超时 —— 和硬指标同一条线。 */
const OVER_RATIO = 1.1;

export function splitGaps(acts: ScorableAct[], durationSec: number): ScoreGaps {
  const byAct: Partial<Record<string, string[]>> = {};
  const mechanical: string[] = [];
  const push = (act: string, msg: string) => {
    (byAct[act] ??= []).push(msg);
  };

  const label = (act: string) => ACT_LABELS[act as ActKey] ?? act;

  // 超时: 直接按幕算, 不去解析硬指标那句汇总文案 —— 解析文案是脆的
  for (const a of acts) {
    const target = a.targetSec ?? 0;
    const sec = estimateSpokenSec(a.narration ?? '');
    if (target > 0 && sec > target * OVER_RATIO) {
      push(a.act, `念下来 ${sec.toFixed(1)} 秒，超出目标 ${(sec - target).toFixed(1)} 秒，要删字`);
    }
  }

  // 垫话: 复用逐句诊断, 位置本来就有
  for (const a of acts) {
    const words = diagnoseSentences(a.narration ?? '')
      .flatMap((s) => s.issues)
      .filter((i) => i.kind === 'filler')
      .map((i) => i.detail.replace(/^垫话:\s*/, ''));
    if (words.length > 0) push(a.act, `有垫话「${[...new Set(words)].join('、')}」，念出来是废字`);
  }

  const hard = scoreHardDimensions(acts, durationSec);
  const has = (key: string) => hard.dimensions.find((d) => d.key === key);

  // 信任声明太靠后 / 完全没有 —— 挪位置或补一句, 都是写法
  const trust = has('trust');
  if (trust && trust.score < trust.max) {
    push(trust.score === 0 ? 'hook' : ACT_KEYS[0], trust.reason);
  }

  // 普适化结尾: 只可能落在收尾那一幕
  const universal = has('universal');
  if (universal && universal.score < universal.max) {
    push('punchline', universal.reason);
  }

  // 幕结构: 画面说明和关键词都不是台词, 单独列
  const structure = has('structure');
  if (structure && structure.score < structure.max) {
    const missingVisual = acts.filter((a) => !(a.visual ?? '').trim()).map((a) => label(a.act));
    const missingBeats = acts.filter((a) => (a.beats?.length ?? 0) === 0).map((a) => label(a.act));
    if (missingVisual.length > 0) {
      mechanical.push(`${missingVisual.join('、')} 没填画面说明 —— 去每一幕的「画面」那一栏写`);
    }
    if (missingBeats.length > 0) {
      mechanical.push(`${missingBeats.join('、')} 没有关键词 —— 关键词是画面上要打的字`);
    }
  }

  // 平台合规扣分是画面里出现了收益元素, 也是改画面那一栏的事
  const compliance = has('compliance');
  if (compliance && compliance.score < compliance.max) {
    mechanical.push(compliance.reason);
  }

  return { byAct, mechanical };
}

/**
 * 对照声称解决了那条丢分, 它真的解决了吗。
 *
 * **动因**: 真机上模型在 whatChanged 里写「删掉垫话」, 而改写后的句子里那个词
 * 原封不动还在。这是最坏的一类不诚实 —— 它比不改更糟, 因为你会以为已经改好了。
 *
 * **只查算得出来的两条**(垫话还在不在、还超不超时)。「结尾够不够普适」「信任声明
 * 位置对不对」要判断, 判断不了的就别乱报: 谎报「你没解决」和谎报「解决了」一样坏。
 */
export function stillOpenGaps(input: {
  rewritten: string;
  gaps: string[];
  targetSec: number;
}): string[] {
  const open: string[] = [];

  for (const gap of input.gaps) {
    // 垫话: 丢分文案里带着那几个词, 直接回查
    const m = gap.match(/有垫话「(.+?)」/);
    if (m) {
      const still = m[1].split('、').filter((w) => input.rewritten.includes(w));
      if (still.length > 0) open.push(`说是删了垫话，但「${still.join('、')}」还在`);
      continue;
    }

    if (/超出目标/.test(gap)) {
      const sec = estimateSpokenSec(input.rewritten);
      if (input.targetSec > 0 && sec > input.targetSec * OVER_RATIO) {
        open.push(`说是删了字，但还是 ${sec.toFixed(1)} 秒，目标 ${input.targetSec.toFixed(1)} 秒`);
      }
      continue;
    }
    // 其余的判断不了, 不报
  }

  return open;
}
