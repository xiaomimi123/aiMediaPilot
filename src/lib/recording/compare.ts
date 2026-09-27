import type { Script, SegmentRole } from '@/lib/script/model';
import type { TranscriptLine } from './transcript';

/** 转写行里能在稿子中对上的字不到一半 → 临场加的 */
export const ADLIB_THRESHOLD = 0.5;
/** 稿子段落里被讲到的字不到三成 → 没讲到 */
export const SKIP_THRESHOLD = 0.3;

export interface ScriptComparison {
  lines: { index: number; matchRatio: number; adlib: boolean }[];
  segments: { id: string; role: SegmentRole; coverage: number; skipped: boolean }[];
  adlibCount: number;
  skippedCount: number;
}

/** 只留字母与数字(含汉字), 标点空白不参与比对 */
const chars = (s: string) => Array.from(s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase());

/**
 * 字级最长公共子序列: 录音是照着稿子念的, 顺序大体一致, LCS 能把"对得上的字"找出来,
 * 剩下的就是临场加的话(转写侧)与没讲到的内容(稿子侧)。
 */
export function compareWithScript(script: Script, lines: TranscriptLine[]): ScriptComparison {
  const a: number[] = []; // 稿子每个字属于第几段
  const aChars: string[] = [];
  script.segments.forEach((s, si) => chars(s.text).forEach((c) => (aChars.push(c), a.push(si))));
  const b: number[] = []; // 转写每个字属于第几行
  const bChars: string[] = [];
  lines.forEach((l, li) => chars(l.text).forEach((c) => (bChars.push(c), b.push(li))));

  const n = aChars.length;
  const m = bChars.length;
  const dp = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = aChars[i] === bChars[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }
  const aHit = new Uint8Array(n);
  const bHit = new Uint8Array(m);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (aChars[i] === bChars[j]) {
      aHit[i] = 1;
      bHit[j] = 1;
      i++;
      j++;
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) i++;
    else j++;
  }

  const lineTotals = lines.map(() => [0, 0]);
  b.forEach((li, k) => {
    lineTotals[li][0]++;
    lineTotals[li][1] += bHit[k];
  });
  const segTotals = script.segments.map(() => [0, 0]);
  a.forEach((si, k) => {
    segTotals[si][0]++;
    segTotals[si][1] += aHit[k];
  });

  const lineResults = lines.map((_, index) => {
    const [total, hit] = lineTotals[index];
    const matchRatio = total === 0 ? 1 : hit / total;
    return { index, matchRatio, adlib: matchRatio < ADLIB_THRESHOLD };
  });
  const segResults = script.segments.map((s, si) => {
    const [total, hit] = segTotals[si];
    const coverage = total === 0 ? 1 : hit / total;
    return { id: s.id, role: s.role, coverage, skipped: coverage < SKIP_THRESHOLD };
  });
  return {
    lines: lineResults,
    segments: segResults,
    adlibCount: lineResults.filter((l) => l.adlib).length,
    skippedCount: segResults.filter((s) => s.skipped).length,
  };
}
