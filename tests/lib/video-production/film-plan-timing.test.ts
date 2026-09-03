import { describe, it, expect } from 'vitest';
import { checkFilmPlanTiming, checkBrollPlanTiming } from '@/lib/video-production/film-plan-timing';
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

describe('checkBrollPlanTiming', () => {
  it('大空档不报 —— 出镜链画面全程有源视频铺底, 空档是设计好的功能', () => {
    // 两镜之间隔了 5 秒(远超 1000ms 的镜间最小间隔), 这段时间露出真人讲话,
    // 观众读得出"回到主讲人"——不该被当成问题喂回模型。
    expect(
      checkBrollPlanTiming(plan(shot('a', 0, 3000), shot('b', 8000, 12000)), 20000),
    ).toEqual([]);
  });

  it('不查"第一镜必须从 0 开始" —— 出镜链完全可能从头到尾都没有卡片', () => {
    expect(checkBrollPlanTiming(plan(shot('a', 5000, 8000)), 20000)).toEqual([]);
  });

  it('分镜为空数组不报问题 —— 出镜链允许没有一处值得做卡片的片段', () => {
    expect(checkBrollPlanTiming(plan(), 20000)).toEqual([]);
  });

  it('超出源视频时长时报出来(totalMs 必须传源视频真实时长)', () => {
    const issues = checkBrollPlanTiming(plan(shot('a', 0, 12000)), 10000);
    expect(issues.some((i) => i.includes('12000') && i.includes('10000'))).toBe(true);
  });

  it('单镜过短(短于 1200ms)时报出来', () => {
    const issues = checkBrollPlanTiming(plan(shot('a', 0, 1000)), 10000);
    expect(issues.some((i) => i.includes('1000') && i.includes('1200'))).toBe(true);
  });

  // ---- 复审补: 镜间最小间隔(BROLL_MIN_GAP_MS = 1000) ----
  // "不查空档"的裁决只对大空档成立——间隙落在 (0, 1000) 之间时, 成片里是真人
  // 画面一闪而过(jump cut 故障感), 不是"正常露出真人"。这组测试钉住这条新规则:
  // 阈值内(500)报、恰好紧邻(0)不报、正常露脸(1500)不报、边界 999/1000 各一条
  // (999 报, 1000 不报)——只测一个远离边界的值区分不了 `<` 和 `<=`, 谁把比较
  // 符号改坏, 边界测试立刻变红。
  describe('镜间最小间隔', () => {
    it('间隙 500ms → 报, 且措辞带上两个具体毫秒数', () => {
      const issues = checkBrollPlanTiming(plan(shot('a', 0, 2000), shot('b', 2500, 5000)), 10000);
      expect(issues.some((i) => i.includes('2000') && i.includes('2500'))).toBe(true);
    });

    it('间隙 0(紧邻) → 不报', () => {
      expect(
        checkBrollPlanTiming(plan(shot('a', 0, 2000), shot('b', 2000, 5000)), 10000),
      ).toEqual([]);
    });

    it('间隙 1500ms(正常露脸) → 不报', () => {
      expect(
        checkBrollPlanTiming(plan(shot('a', 0, 2000), shot('b', 3500, 5000)), 10000),
      ).toEqual([]);
    });

    it('边界: 间隙 999ms → 报', () => {
      const issues = checkBrollPlanTiming(plan(shot('a', 0, 2000), shot('b', 2999, 5000)), 10000);
      expect(issues.length).toBeGreaterThan(0);
    });

    it('边界: 间隙 1000ms(阈值本身) → 不报', () => {
      expect(
        checkBrollPlanTiming(plan(shot('a', 0, 2000), shot('b', 3000, 5000)), 10000),
      ).toEqual([]);
    });

    it('问题描述里给出可执行的三种修法(延后一镜/提前一镜/合并), 不夹带卡片类型名', () => {
      const issues = checkBrollPlanTiming(plan(shot('a', 0, 2000), shot('b', 2500, 5000)), 10000);
      const text = issues.join('');
      expect(text).toContain('endMs');
      expect(text).toContain('startMs');
      expect(text).toContain('合并');
      expect(text).not.toContain('statement');
    });
  });
});
