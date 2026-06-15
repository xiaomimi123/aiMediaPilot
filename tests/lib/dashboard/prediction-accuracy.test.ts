import { describe, expect, it } from 'vitest';
import { verdictOf, deltaPct } from '@/lib/dashboard/prediction-accuracy';

describe('verdictOf', () => {
  const range = { predicted: 2000, lower: 1000, upper: 4000 };

  it('actual 在中心 → in-range', () => {
    expect(verdictOf(2000, range)).toBe('in-range');
  });
  it('actual < lower → over (AI 偏乐观)', () => {
    expect(verdictOf(500, range)).toBe('over');
  });
  it('actual > upper → under (AI 偏保守)', () => {
    expect(verdictOf(8000, range)).toBe('under');
  });
  it('actual == lower → in-range (包含下界)', () => {
    expect(verdictOf(1000, range)).toBe('in-range');
  });
  it('actual == upper → in-range (包含上界)', () => {
    expect(verdictOf(4000, range)).toBe('in-range');
  });
  it('actual = lower - 1 → over', () => {
    expect(verdictOf(999, range)).toBe('over');
  });
  it('actual = upper + 1 → under', () => {
    expect(verdictOf(4001, range)).toBe('under');
  });
});

describe('deltaPct', () => {
  it('actual=2000, predicted=2000 → 0', () => {
    expect(deltaPct(2000, 2000)).toBe(0);
  });
  it('actual=500, predicted=2000 → 75 (|500-2000|/2000)', () => {
    expect(deltaPct(500, 2000)).toBe(75);
  });
  it('actual=8000, predicted=2000 → 300', () => {
    expect(deltaPct(8000, 2000)).toBe(300);
  });
  it('predicted=0 → 0 (除零保护)', () => {
    expect(deltaPct(500, 0)).toBe(0);
  });
  it('predicted<0 (极端) → 0', () => {
    expect(deltaPct(500, -1)).toBe(0);
  });
});
