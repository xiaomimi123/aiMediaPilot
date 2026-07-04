export interface FrameSamplingPlan {
  intervalSec: number;
  expectedCount: number;
}

const MAX_FRAMES = 100;

/** 视频时长 → 抽帧间隔 + 预计帧数。 ≤60s 每 1s; 60-180s 每 3s; >180s 每 6s 但上限 100 帧。 */
export function computeFrameSamplingPlan(durationSec: number): FrameSamplingPlan {
  let intervalSec: number;
  if (durationSec <= 60) intervalSec = 1;
  else if (durationSec <= 180) intervalSec = 3;
  else intervalSec = 6;

  const raw = Math.floor(durationSec / intervalSec);
  return { intervalSec, expectedCount: Math.min(raw, MAX_FRAMES) };
}

/** 钩子分析专用: 前 3 秒每 0.5s 一帧。 */
export function computeHookFrameTimestamps(): number[] {
  return [0, 0.5, 1, 1.5, 2, 2.5];
}

/** 封面候选: t=0, t=duration/3, t=duration/2 三张。 */
export function computeCoverCandidateTimestamps(durationSec: number): number[] {
  return [0, durationSec / 3, durationSec / 2];
}

/**
 * 在 items 里等距取 k 个 (含头含尾)。 items.length <= k 时原样返回。
 * 用 index = round(i * (n-1) / (k-1)) linspace, 保证稳定拿到恰好 k 帧,
 * 而不像 mod-based 降采样在长度非 k 整数倍时给出偏少/偏多的帧数。
 */
export function pickEvenlySpaced<T>(items: T[], k: number): T[] {
  const n = items.length;
  if (k <= 0) return [];
  if (n <= k) return items;
  if (k === 1) return [items[0]];
  const seen = new Set<number>();
  const picked: T[] = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.round((i * (n - 1)) / (k - 1));
    if (seen.has(idx)) continue;
    seen.add(idx);
    picked.push(items[idx]);
  }
  return picked;
}
