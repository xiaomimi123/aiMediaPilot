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
});
