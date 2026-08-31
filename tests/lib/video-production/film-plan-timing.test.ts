import { describe, it, expect } from 'vitest';
import { checkFilmPlanTiming } from '@/lib/video-production/film-plan-timing';
import type { FilmPlan } from '@/lib/video-production/shot-plan';

const shot = (id: string, startMs: number, endMs: number) => ({
  shotId: id, startMs, endMs, card: 'statement' as const, slots: { text: '一句话' },
});
const plan = (...shots: ReturnType<typeof shot>[]) => ({ shots }) as unknown as FilmPlan;

describe('checkFilmPlanTiming', () => {
  it('首尾相接铺满时没有问题', () => {
    expect(checkFilmPlanTiming(plan(shot('a', 0, 5000), shot('b', 5000, 10000)), 10000)).toEqual([]);
  });

  it('中间留空档时报出空档的位置与长度', () => {
    const issues = checkFilmPlanTiming(plan(shot('a', 0, 4000), shot('b', 5000, 10000)), 10000);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('4000');
    expect(issues[0]).toContain('5000');
  });

  it('不从 0 开始时报出来', () => {
    const issues = checkFilmPlanTiming(plan(shot('a', 800, 10000)), 10000);
    expect(issues.some((i) => i.includes('800') && i.includes('第一镜'))).toBe(true);
  });

  it('超出片长时报出来 —— 尾巴上会是没有台词的画面', () => {
    const issues = checkFilmPlanTiming(plan(shot('a', 0, 12000)), 10000);
    expect(issues.some((i) => i.includes('12000') && i.includes('10000'))).toBe(true);
  });

  it('结尾差得少于 1 帧(33ms)不算问题 —— 取整误差不该逼模型重来', () => {
    expect(checkFilmPlanTiming(plan(shot('a', 0, 9980)), 10000)).toEqual([]);
  });

  it('问题描述里不夹带卡片类型的名字 —— 那会把模型引去改卡片而不是改时间', () => {
    const issues = checkFilmPlanTiming(plan(shot('a', 0, 4000), shot('b', 5000, 10000)), 10000);
    expect(issues.join('')).not.toContain('statement');
  });

  // ---- 复审补充: 容差边界(32/33/34ms), 三处独立比较各自钉住 ----
  // TOLERANCE_MS = 33, 边界判断都是 `>` / `<`(不含等号)。
  // 只测一个远离边界的值(比如 brief 原有的 20ms)区分不了 `>` 和 `>=`——
  // 谁把任意一处误改成 `>=`, 那条测试依然全绿。这里用 32/33/34 三个值
  // 把「33 不算问题、34 才算问题」钉死, 三处比较(首镜偏移/镜间空档/末镜差距)
  // 各自独立测, 改坏一处不该被另外两处掩盖。

  describe('容差边界 —— 首镜偏移', () => {
    it('32ms 不报', () => {
      expect(checkFilmPlanTiming(plan(shot('a', 32, 10032)), 10032)).toEqual([]);
    });
    it('33ms(容差本身)不报', () => {
      expect(checkFilmPlanTiming(plan(shot('a', 33, 10033)), 10033)).toEqual([]);
    });
    it('34ms 报', () => {
      const issues = checkFilmPlanTiming(plan(shot('a', 34, 10034)), 10034);
      expect(issues.some((i) => i.includes('第一镜'))).toBe(true);
    });
  });

  describe('容差边界 —— 镜间空档', () => {
    it('32ms 不报', () => {
      expect(
        checkFilmPlanTiming(plan(shot('a', 0, 5000), shot('b', 5032, 10032)), 10032),
      ).toEqual([]);
    });
    it('33ms(容差本身)不报', () => {
      expect(
        checkFilmPlanTiming(plan(shot('a', 0, 5000), shot('b', 5033, 10033)), 10033),
      ).toEqual([]);
    });
    it('34ms 报', () => {
      const issues = checkFilmPlanTiming(plan(shot('a', 0, 5000), shot('b', 5034, 10034)), 10034);
      expect(issues.some((i) => i.includes('黑屏'))).toBe(true);
    });
  });

  describe('容差边界 —— 末镜差距(超出片长方向)', () => {
    it('32ms 不报', () => {
      expect(checkFilmPlanTiming(plan(shot('a', 0, 10032)), 10000)).toEqual([]);
    });
    it('33ms(容差本身)不报', () => {
      expect(checkFilmPlanTiming(plan(shot('a', 0, 10033)), 10000)).toEqual([]);
    });
    it('34ms 报', () => {
      const issues = checkFilmPlanTiming(plan(shot('a', 0, 10034)), 10000);
      expect(issues.some((i) => i.includes('10034') && i.includes('10000'))).toBe(true);
    });
  });

  describe('容差边界 —— 末镜差距(不足片长方向)', () => {
    it('32ms 不报', () => {
      expect(checkFilmPlanTiming(plan(shot('a', 0, 9968)), 10000)).toEqual([]);
    });
    it('33ms(容差本身)不报', () => {
      expect(checkFilmPlanTiming(plan(shot('a', 0, 9967)), 10000)).toEqual([]);
    });
    it('34ms 报', () => {
      const issues = checkFilmPlanTiming(plan(shot('a', 0, 9966)), 10000);
      expect(issues.some((i) => i.includes('9966') && i.includes('10000'))).toBe(true);
    });
  });

  // ---- 复审补充: 不夹带卡片类型名 —— 五条产出路径逐一钉住 ----
  // 只测一条路径不够: `stat` 卡存活率 0/3 的事故就是错误信息里夹带了一个不该
  // 出现的分支词, 模型照字面意思弃了整张卡。能让模型跑偏的字样, 每一条产出
  // 路径都得钉住, 只钉一条等于没钉。
  describe('五条产出路径都不夹带卡片类型名', () => {
    it('分镜为空', () => {
      const issues = checkFilmPlanTiming(plan(), 10000);
      expect(issues.join('')).not.toContain('statement');
    });
    it('首镜不从零起', () => {
      const issues = checkFilmPlanTiming(plan(shot('a', 800, 10000)), 10000);
      expect(issues.join('')).not.toContain('statement');
    });
    it('镜间有空档', () => {
      const issues = checkFilmPlanTiming(plan(shot('a', 0, 4000), shot('b', 5000, 10000)), 10000);
      expect(issues.join('')).not.toContain('statement');
    });
    it('超出片长', () => {
      const issues = checkFilmPlanTiming(plan(shot('a', 0, 12000)), 10000);
      expect(issues.join('')).not.toContain('statement');
    });
    it('不足片长', () => {
      const issues = checkFilmPlanTiming(plan(shot('a', 0, 8000)), 10000);
      expect(issues.join('')).not.toContain('statement');
    });
  });

  // ---- 复审补充: 空分镜分支 ----
  // `FilmPlanSchema` 有 `.min(1)`, 这条分支在 schema 校验之后理论上不可达,
  // 属于防御性代码。已核实其行为、故意保留测试而非仅靠注释说明——
  // 免得下一个读代码的人以为是漏测。
  it('分镜为空数组时给出明确提示(schema 之后理论不可达的防御性分支)', () => {
    expect(checkFilmPlanTiming(plan(), 10000)).toEqual(['分镜是空的, 至少要有一镜。']);
  });
});
