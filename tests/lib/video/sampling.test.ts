import { describe, expect, it } from 'vitest';
import { computeFrameSamplingPlan, computeHookFrameTimestamps } from '@/lib/video/sampling';

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

  it('长 (>180s): 每 6s 抽 1 帧, 上限 100 帧', () => {
    const plan = computeFrameSamplingPlan(600);
    expect(plan.intervalSec).toBe(6);
    expect(plan.expectedCount).toBe(100);
  });

  it('边界 60s 走短视频策略', () => {
    expect(computeFrameSamplingPlan(60).intervalSec).toBe(1);
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
