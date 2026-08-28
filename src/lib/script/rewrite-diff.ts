/**
 * 「我的版 vs AI 版」的改写度对比。
 *
 * 为什么要有这个: 这个工具的分工是**系统给起点 → 你自己写 → 系统做评估**。
 * 中间那段必须是你, 因为那是 AI 和同行都替代不了的部分 —— 用 AI 写久了, 写作
 * 能力会跟着 AI 走, 稿子最后和所有人长得一样, 而可模仿的内容都会被算法抹平。
 *
 * 所以这里量的不是「稿子好不好」, 而是**「这稿子还有多少是 AI 的」**。
 * 一个字没改的幕会被点名: AI 的表达会原样留在成片里。
 */

/** 改写度低于这个值就算「一个字没改」。留一点余量给标点和空格。 */
export const UNTOUCHED_THRESHOLD = 0.02;

/** 标点和空白不算改写内容 —— 改个逗号不叫用自己的话重写。 */
function normalize(text: string): string {
  return (text ?? '').replace(/[\s，。、；：！？,.;:!?—…""''「」《》()（）]/g, '');
}

/** 最长公共子序列长度。中文按字比, 几百字的量级下 O(n·m) 完全够用。 */
function lcsLength(a: string, b: string): number {
  if (!a || !b) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[b.length];
}

/**
 * 改写度: 0 = 一个字没动, 1 = 完全重写。
 *
 * 用 LCS 而不是简单的字数差: 「今天讲一件事」改成「今天讲一件事，很短」只是加了
 * 两个字, 不该算成大改; 而「今天讲一件事」改成「你有没有过这种时候」字数相近,
 * 却是彻底重写。
 */
export function rewriteRatio(baseline: string, current: string): number {
  const a = normalize(baseline);
  const b = normalize(current);
  if (!a && !b) return 0;
  if (!a) return 1;
  const kept = lcsLength(a, b);
  return 1 - kept / Math.max(a.length, b.length);
}

interface ActLike {
  act: string;
  narration: string;
}

export interface ActRewrite {
  act: string;
  rewriteRatio: number;
  baselineChars: number;
  currentChars: number;
  untouched: boolean;
}

export interface RewriteComparison {
  acts: ActRewrite[];
  /** 一个字没改的幕。 */
  untouched: ActRewrite[];
  /** 全篇改写度, 按基线字数加权 —— 长幕没改比短幕没改严重得多。 */
  overallRatio: number;
}

/**
 * 逐幕对比。基线里没有的幕(你自己新加的)不参与统计 —— 无从比较,
 * 但也绝不能算成「未改写」。
 */
export function compareToBaseline(
  current: ActLike[],
  baseline: ActLike[] | null,
): RewriteComparison | null {
  if (!baseline || baseline.length === 0) return null;

  const currentByAct = new Map(current.map((a) => [a.act, a]));
  const acts: ActRewrite[] = [];

  for (const b of baseline) {
    const c = currentByAct.get(b.act);
    const baseText = normalize(b.narration);
    const curText = normalize(c?.narration ?? '');
    const ratio = rewriteRatio(b.narration, c?.narration ?? '');
    acts.push({
      act: b.act,
      rewriteRatio: ratio,
      baselineChars: baseText.length,
      currentChars: curText.length,
      untouched: ratio <= UNTOUCHED_THRESHOLD,
    });
  }

  const totalBaseChars = acts.reduce((n, a) => n + a.baselineChars, 0);
  const overallRatio =
    totalBaseChars > 0
      ? acts.reduce((n, a) => n + a.rewriteRatio * a.baselineChars, 0) / totalBaseChars
      : 0;

  return { acts, untouched: acts.filter((a) => a.untouched), overallRatio };
}
