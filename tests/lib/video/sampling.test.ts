import { describe, expect, it } from 'vitest';
import {
  computeCoverCandidateTimestamps,
  computeFrameSamplingPlan,
  computeHookFrameTimestamps,
  pickEvenlySpaced,
} from '@/lib/video/sampling';

describe('computeFrameSamplingPlan', () => {
  it('短视频 (≤60s): 每 1s 抽 1 帧', () => {
    const plan = computeFrameSamplingPlan(45);
    expect(plan.intervalSec).toBe(1);
    expect(plan.expectedCount).toBe(45);
  });

  it('中等 (60-180s): 每 3s 抽 1 帧', () => {
    const plan = computeFrameSamplingPlan(120);
    expect(plan.intervalSec).toBe(3);
    expect(plan.expectedCount).toBe(40);
  });

  it('长 (>180s): 每 6s 抽 1 帧, 上限 100 帧 (700s 实际压 clamp)', () => {
    const plan = computeFrameSamplingPlan(700);
    expect(plan.intervalSec).toBe(6);
    expect(plan.expectedCount).toBe(100);
  });

  it('边界 60s 走短视频策略', () => {
    const plan = computeFrameSamplingPlan(60);
    expect(plan.intervalSec).toBe(1);
    expect(plan.expectedCount).toBe(60);
  });

  it('0s 视频: intervalSec=1, expectedCount=0', () => {
    const plan = computeFrameSamplingPlan(0);
    expect(plan.intervalSec).toBe(1);
    expect(plan.expectedCount).toBe(0);
  });

  it('边界 180s 走中等策略', () => {
    expect(computeFrameSamplingPlan(180).intervalSec).toBe(3);
  });
});

describe('computeHookFrameTimestamps', () => {
  it('返回前 3 秒每 0.5s 一帧, 共 6 帧 (含 0 和 2.5)', () => {
    expect(computeHookFrameTimestamps()).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
  });
});

describe('computeCoverCandidateTimestamps', () => {
  it('正常 60s: 返回 [0, 20, 30]', () => {
    expect(computeCoverCandidateTimestamps(60)).toEqual([0, 20, 30]);
  });

  it('边界 0s: 全部折叠到 0, 返回 [0, 0, 0]', () => {
    expect(computeCoverCandidateTimestamps(0)).toEqual([0, 0, 0]);
  });
});

describe('pickEvenlySpaced', () => {
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('n <= k 时原样返回', () => {
    expect(pickEvenlySpaced(range(5), 10)).toEqual([0, 1, 2, 3, 4]);
    expect(pickEvenlySpaced(range(10), 10)).toEqual(range(10));
  });

  it('n=200, k=100: 拿到恰好 100 帧, 含首尾', () => {
    const picked = pickEvenlySpaced(range(200), 100);
    expect(picked).toHaveLength(100);
    expect(picked[0]).toBe(0);
    expect(picked[99]).toBe(199);
  });

  it('n=101, k=100 (旧 mod 公式的坏 case): 应拿到 100 帧, 不是 51 帧', () => {
    const picked = pickEvenlySpaced(range(101), 100);
    expect(picked).toHaveLength(100);
    expect(picked[0]).toBe(0);
    expect(picked[99]).toBe(100);
  });

  it('n=150, k=100: 恰好 100 帧, 无重复', () => {
    const picked = pickEvenlySpaced(range(150), 100);
    expect(picked).toHaveLength(100);
    expect(new Set(picked).size).toBe(100);
    expect(picked[0]).toBe(0);
    expect(picked[99]).toBe(149);
  });

  it('n=250, k=100: 恰好 100 帧', () => {
    const picked = pickEvenlySpaced(range(250), 100);
    expect(picked).toHaveLength(100);
    expect(picked[0]).toBe(0);
    expect(picked[99]).toBe(249);
  });

  it('k=1: 返回首元素', () => {
    expect(pickEvenlySpaced(range(50), 1)).toEqual([0]);
  });

  it('k=0 或负数: 空数组', () => {
    expect(pickEvenlySpaced(range(50), 0)).toEqual([]);
    expect(pickEvenlySpaced(range(50), -1)).toEqual([]);
  });
});
