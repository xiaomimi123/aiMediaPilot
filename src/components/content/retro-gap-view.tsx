import { DimensionCard } from './dimension-card';

type Accuracy = 'on-target' | 'over-estimated' | 'under-estimated' | 'unknown';

type RetroReport = {
  hookGap: { predictedRating: number; takeaway: string; accuracy: Accuracy };
  retentionGap: { predictedRiskPoints: number; takeaway: string; accuracy: Accuracy };
  titleCaptionGap: { mode: string; takeaway: string; accuracy: Accuracy };
  coverGap: { mode: string; takeaway: string; accuracy: Accuracy };
  overallTakeaway: string;
  predictedOverallScore: number | null;
  inferredActualScore: number | null;
};

const ACCURACY_LABEL: Record<Accuracy, string> = {
  'on-target': '✓ on-target',
  'over-estimated': '⚠ over-estimated',
  'under-estimated': '⚠ under-estimated',
  'unknown': '? unknown',
};

const ACCURACY_COLOR: Record<Accuracy, string> = {
  'on-target': 'text-green-600',
  'over-estimated': 'text-amber-600',
  'under-estimated': 'text-amber-600',
  'unknown': 'text-[var(--muted)]',
};

export function RetroGapView({ report }: { report: RetroReport }) {
  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">🎯 AI 落差总结</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <DimensionCard emoji="🪝" title={`钩子 (预判 ★${report.hookGap.predictedRating})`}>
          <div className={`text-xs ${ACCURACY_COLOR[report.hookGap.accuracy]}`}>{ACCURACY_LABEL[report.hookGap.accuracy]}</div>
          <p className="mt-1 text-sm">{report.hookGap.takeaway}</p>
        </DimensionCard>
        <DimensionCard emoji="⏱" title={`完播 (${report.retentionGap.predictedRiskPoints} 风险点)`}>
          <div className={`text-xs ${ACCURACY_COLOR[report.retentionGap.accuracy]}`}>{ACCURACY_LABEL[report.retentionGap.accuracy]}</div>
          <p className="mt-1 text-sm">{report.retentionGap.takeaway}</p>
        </DimensionCard>
        <DimensionCard emoji="📝" title={`标题文案 (${report.titleCaptionGap.mode})`}>
          <div className={`text-xs ${ACCURACY_COLOR[report.titleCaptionGap.accuracy]}`}>{ACCURACY_LABEL[report.titleCaptionGap.accuracy]}</div>
          <p className="mt-1 text-sm">{report.titleCaptionGap.takeaway}</p>
        </DimensionCard>
        <DimensionCard emoji="🖼" title={`封面 (${report.coverGap.mode})`}>
          <div className={`text-xs ${ACCURACY_COLOR[report.coverGap.accuracy]}`}>{ACCURACY_LABEL[report.coverGap.accuracy]}</div>
          <p className="mt-1 text-sm">{report.coverGap.takeaway}</p>
        </DimensionCard>
      </div>
      <div className="rounded-lg bg-[var(--surface-soft)] p-3 text-sm">
        <div className="font-semibold">📌 综合</div>
        <p className="mt-1">{report.overallTakeaway}</p>
        {report.predictedOverallScore !== null && report.inferredActualScore !== null && (
          <p className="mt-1 text-[var(--muted)]">
            预判综合 {report.predictedOverallScore}/100,实测推算 {report.inferredActualScore}/100
          </p>
        )}
      </div>
    </div>
  );
}
