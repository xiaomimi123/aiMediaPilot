import { describe, expect, it } from 'vitest';
import { isBehind } from '@/lib/predict/lag';

describe('lag', () => {
  it('flags day 1 below 30% and day 2 below 50% of the center', () => {
    expect(isBehind(1.2, 800, 3000)).toBe(true);
    expect(isBehind(1.2, 1000, 3000)).toBe(false);
    expect(isBehind(2.5, 1400, 3000)).toBe(true);
    expect(isBehind(2.5, 1600, 3000)).toBe(false);
  });
  it('does not flag the publish day', () => {
    expect(isBehind(0.5, 10, 3000)).toBe(false);
  });
  it('stops after day 3', () => {
    expect(isBehind(3.1, 10, 3000)).toBe(false);
  });
});
