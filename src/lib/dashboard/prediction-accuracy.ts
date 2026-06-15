import type { PredictionVerdict } from './types';

export function verdictOf(
  actual: number,
  range: { predicted: number; lower: number; upper: number }
): PredictionVerdict {
  if (actual < range.lower) return 'over';
  if (actual > range.upper) return 'under';
  return 'in-range';
}

export function deltaPct(actual: number, predicted: number): number {
  if (predicted <= 0) return 0;
  return Math.round((Math.abs(actual - predicted) / predicted) * 100);
}
