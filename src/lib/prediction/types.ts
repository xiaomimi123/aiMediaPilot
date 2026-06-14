export type PredictionConfidence = 'low' | 'medium' | 'high';
export type PredictionBasisSource = 'onboarding' | 'retro-median';

export interface PredictedPlaysRange {
  predicted: number;
  lower: number;
  upper: number;
  confidence: PredictionConfidence;
  basisSource: PredictionBasisSource;
  basisValue: number;
}

export interface ResolvedBaseline {
  value: number;
  source: PredictionBasisSource;
  retroSampleCount: number;
}
