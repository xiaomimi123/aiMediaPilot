import { describe, it, expect } from 'vitest';
import { judgeOverlap, MAX_COVER_RATIO } from '@/lib/video-production/frame-overlap';

/*
 * 真实缺陷: 我们成片第 20 秒, 顶部标题「差距不在技术，在提问」被两张卡片压住,
 * 「差距」二字完全被盖掉。现有五道体检关(空屏/空壳/版面/裁字/静止)**没有一道
 * 查元素互相遮挡**, 所以它一路进了成片。
 */

describe('judgeOverlap', () => {
  it('没有遮挡 → 过', () => {
    expect(judgeOverlap([{ occluded: [] }, { occluded: [] }]).ok).toBe(true);
  });

  it('单帧偶发的轻微遮挡 → 过(阈值以下)', () => {
    expect(judgeOverlap([{ occluded: [{ coverRatio: 0.05, text: '轻微' }] }]).ok).toBe(true);
  });

  it('文字被盖住超过阈值 → 拦, 并说出被盖的是哪句', () => {
    const r = judgeOverlap([{ occluded: [{ coverRatio: 0.62, text: '差距不在技术，在提问' }] }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('差距不在技术');
    expect(r.reason).toContain('62%');
  });

  it('阈值本身留在导出常量上, 不写魔法数字', () => {
    expect(MAX_COVER_RATIO).toBe(0.15);
    expect(judgeOverlap([{ occluded: [{ coverRatio: MAX_COVER_RATIO, text: '正好卡线' }] }]).ok).toBe(true);
  });

  it('没有取样帧 → 过, 不是"因为量不到所以判不合格"', () => {
    expect(judgeOverlap([]).ok).toBe(true);
  });
});
