import type { CalibrationData } from '@/lib/dashboard/types';
import type {
  PredictedPlaysRange,
  PredictionBasisSource,
  PredictionConfidence,
} from './types';

const MAX_PREDICTED = 1e9;
const MIN_PREDICTED = 0;

export function scoreMultiplier(overallScore: number): number {
  return Math.exp((overallScore - 50) / 30);
}

export function calibrationFactor(cal: CalibrationData | null): number {
  if (!cal) return 1.0;
  const dims = Object.values(cal.matrix);
  const avgOverPct =
    dims.reduce((s, d) => s + (d.total ? d.overEstimated / d.total : 0), 0) / 4;
  const avgUnderPct =
    dims.reduce((s, d) => s + (d.total ? d.underEstimated / d.total : 0), 0) / 4;
  if (avgOverPct >= 0.4) return 0.7;
  if (avgUnderPct >= 0.4) return 1.3;
  return 1.0;
}

function confidenceFor(retroCount: number): PredictionConfidence {
  if (retroCount >= 10) return 'high';
  if (retroCount >= 3) return 'medium';
  return 'low';
}

function clamp(n: number): number {
  if (!Number.isFinite(n) || n < MIN_PREDICTED) return MIN_PREDICTED;
  if (n > MAX_PREDICTED) return MAX_PREDICTED;
  return n;
}

export function computePrediction(input: {
  overallScore: number;
  baseline: number;
  calibration: CalibrationData | null;
  retroSampleCount: number;
  basisSource: PredictionBasisSource;
}): PredictedPlaysRange {
  const mult = scoreMultiplier(input.overallScore);
  const calFactor = calibrationFactor(input.calibration);
  const rawPredicted = input.baseline * mult * calFactor;
  const predicted = Math.round(clamp(rawPredicted));
  return {
    predicted,
    lower: Math.round(predicted * 0.5),
    upper: Math.round(clamp(predicted * 2)),
    confidence: confidenceFor(input.retroSampleCount),
    basisSource: input.basisSource,
    basisValue: input.baseline,
  };
}

export function formatPlays(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 10000).toFixed(1)}w`;
}
