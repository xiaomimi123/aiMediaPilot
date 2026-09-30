/** 爆款 = 比这个账号平时好很多。只看点赞: 他人作品的播放量接口恒为 0。 */
export const HIT_RATIO = 3;
export const HIT_MIN_DIGG = 1000;
export const HIT_MAX_AGE_DAYS = 30;
export const BASELINE_DAYS = 90;
export const BASELINE_MIN_WORKS = 3;

const DAY = 86400_000;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeBaseline(works: { digg: number; publishedAt: Date }[], now: Date): number | null {
  const recent = works.filter((w) => now.getTime() - w.publishedAt.getTime() <= BASELINE_DAYS * DAY).map((w) => w.digg);
  return recent.length >= BASELINE_MIN_WORKS ? Math.round(median(recent)) : null;
}

export function judge(w: { digg: number; publishedAt: Date }, baseline: number | null, now: Date): { ratio: number | null; isHit: boolean } {
  if (!baseline) return { ratio: null, isHit: false };
  const ratio = Math.round((w.digg / baseline) * 10) / 10;
  const fresh = now.getTime() - w.publishedAt.getTime() <= HIT_MAX_AGE_DAYS * DAY;
  return { ratio, isHit: fresh && w.digg >= HIT_MIN_DIGG && w.digg >= baseline * HIT_RATIO };
}
