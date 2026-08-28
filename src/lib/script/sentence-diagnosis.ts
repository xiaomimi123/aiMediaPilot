import { FILLER_PATTERNS } from '@/lib/cockpit/script-score';

/**
 * 逐句诊断(二十三期)。
 *
 * **给问题的位置, 不给替换的文字。** 这是这个模块存在的全部意义。
 *
 * 硬指标已经知道「垫话 1 处: 这个东西」, 但它不告诉你是哪一句 —— 一份 60 秒的稿子
 * 三百多字, 「有一处垫话」等于让你自己从头读一遍找。位置信息就在计算过程里, 只是
 * 之前被汇总成一个数字丢掉了。
 *
 * **全部是纯函数, 不调模型。** 一是免费且每次结果一样; 二是更重要的 —— 让模型判断
 * 「这句写得好不好」, 它的下一句话必然是「不如改成……」, 而那正是要避的东西: AI
 * 润色过的句子, AI 也会写给别人。规则能指出的东西(垫话、气口、套话、重复)本来就
 * 不需要判断力, 剩下那些需要判断力的, 该由你自己看。
 */

export interface Sentence {
  text: string;
  /** 在原文中的起始下标 —— 前端要据此定位高亮。 */
  start: number;
  issues: SentenceIssue[];
}

export type IssueKind = 'filler' | 'breath' | 'cliche' | 'repeat';

export interface SentenceIssue {
  kind: IssueKind;
  /** 说清楚是什么问题, **不含**改写建议。 */
  detail: string;
}

export const ISSUE_LABELS: Record<IssueKind, string> = {
  filler: '垫话',
  breath: '气口太长',
  cliche: '套话',
  repeat: '和前面重复',
};

/**
 * 套话句式。
 *
 * 和垫话的区别: 垫话是**可以直接删掉**的废字(「说实话」), 套话是**整句没有信息**
 * 的写法(「在这个飞速发展的时代」)。删一个词救不了后者, 所以分开报。
 *
 * 同样用正则不用裸串 —— 中文没有词边界, 踩过一次。
 */
const CLICHE_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: '在这个……的时代', pattern: /在这个.{0,10}(时代|年代)/ },
  { name: '随着……的发展', pattern: /随着.{0,12}(的)?(发展|普及|到来|兴起)/ },
  { name: '越来越重要', pattern: /越来越(重要|普及|火)/ },
  { name: '不言而喻', pattern: /不言而喻/ },
  { name: '让我们一起', pattern: /让我们(一起)?来?/ },
  { name: '毋庸置疑', pattern: /毋庸置疑/ },
  { name: '大家好', pattern: /^大家好/ },
  { name: '话不多说', pattern: /话不多说/ },
  { name: '干货满满', pattern: /干货满满/ },
  { name: '看到最后', pattern: /看到最后/ },
];

/** 一口气最多这么多字 —— 和硬指标同一个量级, 按逗号切出的气口算。 */
const MAX_BREATH = 28;

/** 重复判定阈值: 两句的字重合到这个比例就算在说同一件事。 */
const REPEAT_RATIO = 0.75;

/**
 * 切句。
 *
 * 按**句末标点**切而不是逗号: 逗号是气口不是句子, 按逗号切会把一句完整的话拆成
 * 三个「没信息量」的碎片, 那样的诊断全是噪音。气口长度另有一条规则管。
 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const isEnd = '。！？!?\n'.includes(text[i]);
    if (!isEnd && i !== text.length - 1) continue;

    const end = i + 1;
    const raw = text.slice(start, end);
    if (raw.trim()) {
      // 起点跳过前导空白, 让 start 指向真正的第一个字
      const lead = raw.length - raw.trimStart().length;
      out.push({ text: raw.trim(), start: start + lead, issues: [] });
    }
    start = end;
  }

  return out;
}

/** 去掉标点, 用来比对两句是不是在说同一件事。 */
function bare(text: string): string {
  return text.replace(/[\s，。、；：！？,.;:!?—…""''「」《》()（）]/g, '');
}

/** 字级重合比例 —— 短的那句被长的那句覆盖了多少。 */
function overlapRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const pool = new Map<string, number>();
  for (const ch of long) pool.set(ch, (pool.get(ch) ?? 0) + 1);

  let hit = 0;
  for (const ch of short) {
    const n = pool.get(ch) ?? 0;
    if (n > 0) { hit++; pool.set(ch, n - 1); }
  }
  return hit / short.length;
}

/**
 * 最长的一个气口(按逗号切)有多少字。
 *
 * 口播真正的换气点是**逗号**不是句号: 「今年很火的那个开源项目，我靠给别人安装它，
 * 赚到了第一笔钱」整句 30 多字, 但每个气口都很短, 念起来一点不憋。按整句长度判会
 * 把这种好句子误报成问题。
 */
function longestBreath(text: string): number {
  const units = text.split(/[，,、；;]/).map((u) => bare(u).length);
  return units.length > 0 ? Math.max(...units) : 0;
}

/**
 * 逐句诊断整段旁白。
 *
 * 返回的每一项都只说「这里有什么问题」。**不给替换文字**, 也不给分数 —— 打分是
 * 评分面板的事, 这里回答的是另一个问题: 我该看哪一句。
 */
export function diagnoseSentences(narration: string): Sentence[] {
  const sentences = splitSentences(narration);
  const seen: string[] = [];

  for (const s of sentences) {
    const body = bare(s.text);

    // 垫话: 复用硬指标那份表, 位置本来就在计算过程里, 只是之前被汇总掉了
    const fillers = FILLER_PATTERNS.filter((f) => {
      f.pattern.lastIndex = 0; // 表里是 /g, 不重置会隔次漏判
      return f.pattern.test(s.text);
    }).map((f) => f.word);
    if (fillers.length > 0) {
      s.issues.push({ kind: 'filler', detail: `垫话: ${fillers.join('、')}` });
    }

    const breath = longestBreath(s.text);
    if (breath > MAX_BREATH) {
      s.issues.push({ kind: 'breath', detail: `最长的一口气 ${breath} 字，念到后面会憋` });
    }

    const cliche = CLICHE_PATTERNS.find((c) => c.pattern.test(s.text));
    if (cliche) {
      s.issues.push({ kind: 'cliche', detail: `套话句式「${cliche.name}」，整句没有你的信息` });
    }

    // 重复只标**后**出现的那句: 先说的是原话, 后说的才是冗余
    if (body.length >= 8 && seen.some((p) => overlapRatio(body, p) >= REPEAT_RATIO)) {
      s.issues.push({ kind: 'repeat', detail: '和前面某句在说同一件事' });
    }
    if (body.length >= 8) seen.push(body);
  }

  return sentences;
}
