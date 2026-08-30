import { describe, it, expect } from 'vitest';
import { scoreAttempt, pickBestAttempt } from '@/lib/video-production/attempt-score';

describe('scoreAttempt', () => {
  it('过的关越多分越高', () => {
    const all = scoreAttempt({ densityOk: true, hollowOk: true, layoutOk: true, overlapOk: true, detailRatio: 0.05, contentRatio: 0.1 });
    const two = scoreAttempt({ densityOk: true, hollowOk: true, layoutOk: false, overlapOk: true, detailRatio: 0.05, contentRatio: 0.1 });
    expect(all).toBeGreaterThan(two);
  });

  it('同样过两关时, 细节比值高的更好', () => {
    const rich = scoreAttempt({ densityOk: true, hollowOk: true, layoutOk: false, overlapOk: true, detailRatio: 0.09, contentRatio: 0.1 });
    const thin = scoreAttempt({ densityOk: true, hollowOk: true, layoutOk: false, overlapOk: true, detailRatio: 0.01, contentRatio: 0.1 });
    expect(rich).toBeGreaterThan(thin);
  });

  it('全空的一版分最低', () => {
    const blank = scoreAttempt({ densityOk: false, hollowOk: true, layoutOk: false, overlapOk: true, detailRatio: 0, contentRatio: 0 });
    const some = scoreAttempt({ densityOk: false, hollowOk: true, layoutOk: true, overlapOk: true, detailRatio: 0.02, contentRatio: 0.05 });
    expect(some).toBeGreaterThan(blank);
  });

  it('其它三关相同、只有遮挡不同时, 遮挡通过的那版分更高', () => {
    // 画面关现在是四道: 密度/空壳/版面都过, 但一版有遮挡、一版没有 —— 干净的那版
    // 必须分更高, 否则「三次都不合格时谁最不坏」这个排序对遮挡完全失明。
    const clean = scoreAttempt({ densityOk: true, hollowOk: true, layoutOk: true, overlapOk: true, detailRatio: 0.05, contentRatio: 0.1 });
    const occluded = scoreAttempt({ densityOk: true, hollowOk: true, layoutOk: true, overlapOk: false, detailRatio: 0.05, contentRatio: 0.1 });
    expect(clean).toBeGreaterThan(occluded);
  });
});

describe('pickBestAttempt', () => {
  it('挑分最高的那一版, 而不是最后一版', () => {
    const best = pickBestAttempt([
      { html: 'a', score: 1 },
      { html: 'b', score: 3 },
      { html: 'c', score: 2 },
    ]);
    expect(best).toBe('b');
  });

  it('分数相同取先出现的 —— 早一版通常更贴合原始指令', () => {
    expect(pickBestAttempt([{ html: 'a', score: 2 }, { html: 'b', score: 2 }])).toBe('a');
  });

  it('一版都没有时返回 null, 由调用方决定怎么办', () => {
    expect(pickBestAttempt([])).toBeNull();
  });
});
