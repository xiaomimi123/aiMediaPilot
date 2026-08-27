import { describe, it, expect } from 'vitest';
import { buildPipeline, buildTodos } from '@/lib/cockpit/overview';

describe('buildPipeline', () => {
  const counts = { radar: 102, adopted: 7, scripts: 25, films: 0, published: 0 };

  it('五环顺序固定', () => {
    expect(buildPipeline(counts).map((s) => s.label)).toEqual([
      '雷达抓取', '采纳选题', '成稿', '出片', '发布',
    ]);
  });

  it('转化率按上一环算, 第一环没有转化率', () => {
    const p = buildPipeline(counts);
    expect(p[0].conversion).toBeNull();
    expect(p[1].conversion).toBeCloseTo(7 / 102);
  });

  it('只标第一个断点 —— 后面的 0 是后果不是新问题', () => {
    const p = buildPipeline(counts);
    expect(p.find((s) => s.key === 'films')!.broken).toBe(true);
    expect(p.find((s) => s.key === 'published')!.broken).toBe(false);
  });

  it('这一环是 0 但下游有量 → 不是断点, 是被绕过 —— 稿子可以不从选题来', () => {
    const p = buildPipeline({ radar: 102, adopted: 0, scripts: 25, films: 0, published: 0 });
    expect(p.find((s) => s.key === 'adopted')!.broken).toBe(false);
    expect(p.find((s) => s.key === 'adopted')!.bypassed).toBe(true);
    // 真正断的是出片
    expect(p.find((s) => s.key === 'films')!.broken).toBe(true);
  });

  it('上一环本来就是 0 时不算断点 —— 没进料不叫堵', () => {
    const p = buildPipeline({ radar: 0, adopted: 0, scripts: 0, films: 0, published: 0 });
    expect(p.every((s) => !s.broken)).toBe(true);
  });

  it('链路全通时没有断点', () => {
    const p = buildPipeline({ radar: 10, adopted: 5, scripts: 4, films: 2, published: 1 });
    expect(p.every((s) => !s.broken)).toBe(true);
  });
});

describe('buildTodos', () => {
  const base = {
    workerOnline: true,
    queuedFilms: 0,
    oldestQueuedDays: null,
    overtimeScripts: 0,
    lowConfidenceFacts: 0,
    radarBacklog: 0,
  };

  it('worker 没跑且有任务积压 → 第一条就是启动它', () => {
    const t = buildTodos({ ...base, workerOnline: false, queuedFilms: 9, oldestQueuedDays: 17 });
    expect(t[0].tone).toBe('block');
    expect(t[0].text).toContain('worker');
    expect(t[0].detail).toContain('17 天');
  });

  it('worker 没跑但队列是空的 → 不打扰 —— 没任务时它不在也无所谓', () => {
    const t = buildTodos({ ...base, workerOnline: false, queuedFilms: 0 });
    expect(t.some((x) => x.text.includes('worker'))).toBe(false);
  });

  it('挡住整条链路的排在只影响单条内容的前面', () => {
    const t = buildTodos({
      ...base, workerOnline: false, queuedFilms: 9, oldestQueuedDays: 3,
      overtimeScripts: 3, lowConfidenceFacts: 1,
    });
    expect(t.map((x) => x.tone)).toEqual(['block', 'warn', 'warn']);
  });

  it('雷达堆积不到 50 条不提示 —— 攒一点是正常的', () => {
    expect(buildTodos({ ...base, radarBacklog: 30 })).toHaveLength(0);
    expect(buildTodos({ ...base, radarBacklog: 102 })).toHaveLength(1);
  });

  it('一切正常时是空数组, 不硬凑待办', () => {
    expect(buildTodos(base)).toEqual([]);
  });
});
