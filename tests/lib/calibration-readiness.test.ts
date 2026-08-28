import { describe, it, expect } from 'vitest';
import { assessCalibration } from '@/lib/works/calibration';

describe('assessCalibration', () => {
  it('**关联了稿子但那份稿子没有预测分的不算样本** —— 否则「样本够了」是句谎话', () => {
    const r = assessCalibration([{ predictedHard: 22 }, { predictedHard: null }], 0, 5);
    expect(r.paired).toBe(1);
  });

  it('差多少条说清楚, 不只说「不够」', () => {
    const r = assessCalibration([{ predictedHard: 20 }], 3, 5);
    expect(r.missing).toBe(4);
    expect(r.ready).toBe(false);
  });

  it('够了就是够了', () => {
    const r = assessCalibration(Array.from({ length: 5 }, () => ({ predictedHard: 20 })), 0, 5);
    expect(r.ready).toBe(true);
    expect(r.missing).toBe(0);
  });

  it('可认领数单独报 —— 它回答的是「我现在能做什么」', () => {
    expect(assessCalibration([], 7, 5).claimable).toBe(7);
  });

  it('一条样本都没有时不会算出负数', () => {
    const r = assessCalibration([], 0, 5);
    expect(r.missing).toBe(5);
    expect(r.paired).toBe(0);
  });
});
