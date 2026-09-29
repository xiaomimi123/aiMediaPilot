import { median } from '@/lib/benchmark/rules';

export const BASELINE_SIZE = 10;
export const MIN_BASELINE = 3;
export const THRESHOLD = 0.2;

export interface MetricSet {
  viewCount: number | null;
  likeCount: number | null;
  favoriteCount: number | null;
  shareCount: number | null;
  subscribeCount: number | null;
  completionRate: number | null;
  completionRate5s: number | null;
  bounceRate2s: number | null;
  avgViewSec: number | null;
}

export type Verdict = 'good' | 'even' | 'bad' | 'na';
type Key = 'hook2s' | 'hook5s' | 'middle' | 'ending' | 'like' | 'favorite' | 'share' | 'subscribe';

export interface StageResult {
  key: Key;
  label: string;
  value: number | null;
  baseline: number | null;
  verdict: Verdict;
  note: string;
}

export interface Diagnosis {
  stages: StageResult[];
  baselineCount: number;
  dropAt: { sec: number; segment: string | null; line: string | null } | null;
  benchmark: { theirRatio: number; myRatio: number | null } | null;
  curve: { day: string; viewCount: number | null; likeCount: number | null }[];
}

const rate = (n: number | null, v: number | null) => (n === null || !v ? null : n / v);

function values(m: MetricSet): Record<Key, number | null> {
  return {
    hook2s: m.bounceRate2s,
    hook5s: m.completionRate5s,
    middle: m.avgViewSec,
    ending: m.completionRate,
    like: rate(m.likeCount, m.viewCount),
    favorite: rate(m.favoriteCount, m.viewCount),
    share: rate(m.shareCount, m.viewCount),
    subscribe: rate(m.subscribeCount, m.viewCount),
  };
}

const LABEL: Record<Key, string> = {
  hook2s: '开头 2 秒（跳出率）',
  hook5s: '前 5 秒（完播率）',
  middle: '中段（平均观看）',
  ending: '收尾（完播率）',
  like: '点赞率',
  favorite: '收藏率',
  share: '分享率',
  subscribe: '吸粉率',
};

const charSet = (s: string) => new Set(Array.from(s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()));

/** 每句转写归到字重合度最高的那段稿子; 最高也不到 30%(临场发挥)就不归段 */
export function assignSegments(segments: { label: string; text: string }[], lines: { startSec: number; endSec: number; text: string }[]) {
  const segSets = segments.map((s) => ({ label: s.label, set: charSet(s.text) }));
  return lines.map((l) => {
    const ls = charSet(l.text);
    let best: { label: string; r: number } | null = null;
    for (const s of segSets) {
      const r = ls.size ? [...ls].filter((c) => s.set.has(c)).length / ls.size : 0;
      if (!best || r > best.r) best = { label: s.label, r };
    }
    return { ...l, segment: best && best.r >= 0.3 ? best.label : null };
  });
}

export function computeBaseline(history: MetricSet[]) {
  const recent = history.slice(0, BASELINE_SIZE);
  const medians: Partial<Record<Key, number>> = {};
  for (const k of Object.keys(LABEL) as Key[]) {
    const xs = recent.map((m) => values(m)[k]).filter((x): x is number => x !== null);
    if (xs.length >= MIN_BASELINE) medians[k] = median(xs);
  }
  const likes = recent.map((m) => m.likeCount).filter((x): x is number => x !== null);
  return { count: recent.length, medians, likeMedian: likes.length >= MIN_BASELINE ? median(likes) : null };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function verdictOf(key: Key, v: number | null, b: number | null): Verdict {
  if (v === null || b === null || b === 0) return 'na';
  const diff = (v - b) / b;
  const better = key === 'hook2s' ? diff < -THRESHOLD : diff > THRESHOLD;
  const worse = key === 'hook2s' ? diff > THRESHOLD : diff < -THRESHOLD;
  return better ? 'good' : worse ? 'bad' : 'even';
}

export function diagnose(input: {
  work: MetricSet;
  history: MetricSet[];
  lines: { startSec: number; endSec: number; text: string; segment: string | null }[] | null;
  benchmark: { digg: number; baselineDigg: number | null } | null;
  curve: Diagnosis['curve'];
}): Diagnosis {
  const base = computeBaseline(input.history);
  const enough = base.count >= MIN_BASELINE;
  const v = values(input.work);
  const sec = input.work.avgViewSec;
  const hitLine = sec !== null && input.lines ? input.lines.find((l) => sec >= l.startSec && sec < l.endSec) ?? input.lines.at(-1) ?? null : null;
  const dropAt = sec === null ? null : { sec, segment: hitLine?.segment ?? null, line: hitLine?.text ?? null };

  const stages = (Object.keys(LABEL) as Key[]).map((key): StageResult => {
    const value = v[key];
    const baseline = enough ? base.medians[key] ?? null : null;
    const verdict = enough ? verdictOf(key, value, baseline) : 'na';
    let note: string;
    if (key === 'middle' && dropAt) {
      note = dropAt.line
        ? `平均在第 ${Math.round(dropAt.sec)} 秒离开，这时在讲「${dropAt.segment ?? '—'}」：『${dropAt.line}』`
        : `平均在第 ${Math.round(dropAt.sec)} 秒离开（没有转写，对不到具体句子）`;
    } else if (value === null) note = '数据还没出来';
    else note = key === 'middle' ? `${value.toFixed(1)} 秒` : pct(value);
    if (!enough && value !== null) note += `（历史作品太少，暂不和平时比）`;
    else if (baseline !== null) note += `；平时 ${key === 'middle' ? `${baseline.toFixed(1)} 秒` : pct(baseline)}`;
    return { key, label: LABEL[key], value, baseline, verdict, note };
  });

  const benchmark =
    input.benchmark && input.benchmark.baselineDigg
      ? {
          theirRatio: Math.round((input.benchmark.digg / input.benchmark.baselineDigg) * 10) / 10,
          myRatio: base.likeMedian && input.work.likeCount !== null ? Math.round((input.work.likeCount / base.likeMedian) * 10) / 10 : null,
        }
      : null;

  return { stages, baselineCount: base.count, dropAt, benchmark, curve: input.curve };
}
