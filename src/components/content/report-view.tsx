import { DimensionCard } from './dimension-card';
import { CoverCandidates } from './cover-candidates';

type Report = {
  hook?: { rating: number; summary: string; suggestions: string[]; keyObservations: { timestampSec: number; note: string }[]; error?: string };
  retention?: { riskPoints: { startSec: number; endSec: number; severity: string; reason: string; suggestion: string }[]; overallSummary: string; error?: string };
  titleCaption?: any;
  cover?: any;
  overallScore: number | null;
  topActionItems: string[];
};

export function ReportView({ analysisId, report, coverCandidateCount }: { analysisId: string; report: Report; coverCandidateCount: number }) {
  return (
    <div className="space-y-6">
      {/* 综合分 + topActions */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-bg)] p-6">
        <div className="flex items-center gap-6">
          {report.overallScore !== null && (
            <div className="text-center">
              <div className="text-4xl font-bold">{report.overallScore}</div>
              <div className="text-xs text-[var(--muted)]">/100</div>
            </div>
          )}
          <div className="flex-1">
            <div className="mb-2 text-sm font-semibold">现在去改的:</div>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {report.topActionItems.map((a, i) => <li key={i}>{a}</li>)}
            </ol>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DimensionCard
          title="钩子 (前 3 秒)"
          rating={report.hook?.rating}
          error={report.hook?.error}
        >
          <p className="text-sm">{report.hook?.summary}</p>
          {(report.hook?.suggestions ?? []).length > 0 && (
            <>
              <div className="mt-2 text-xs font-semibold text-[var(--muted)]">建议:</div>
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {(report.hook?.suggestions ?? []).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </>
          )}
        </DimensionCard>

        <DimensionCard
          title="完播风险"
          error={report.retention?.error}
        >
          <p className="text-sm">{report.retention?.overallSummary}</p>
          {(report.retention?.riskPoints ?? []).length > 0 && (
            <div className="mt-2 space-y-1 text-sm">
              {(report.retention?.riskPoints ?? []).map((r, i) => (
                <div key={i} className="rounded-md bg-[var(--surface-soft)] p-2 text-xs">
                  <span className={r.severity === 'high' ? 'text-destructive' : r.severity === 'medium' ? 'text-amber-600' : 'text-[var(--muted)]'}>
                    [{r.startSec.toFixed(1)}-{r.endSec.toFixed(1)}s · {r.severity}]
                  </span>{' '}
                  {r.reason} → <em>{r.suggestion}</em>
                </div>
              ))}
            </div>
          )}
        </DimensionCard>

        <DimensionCard title="标题 / 文案" error={report.titleCaption?.error}>
          {report.titleCaption?.mode === 'generate' && (
            <div className="space-y-2 text-sm">
              <div>
                <div className="text-xs font-semibold text-[var(--muted)]">AI 生成的标题候选:</div>
                <ul className="list-disc pl-4">{(report.titleCaption.generatedTitles ?? []).map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
              </div>
              <div>
                <div className="text-xs font-semibold text-[var(--muted)]">AI 生成的文案候选:</div>
                <ul className="list-disc pl-4">{(report.titleCaption.generatedCaptions ?? []).map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>
              </div>
            </div>
          )}
          {report.titleCaption?.mode === 'evaluate' && (
            <div className="space-y-2 text-sm">
              {report.titleCaption.titleFeedback && (
                <div>
                  <div className="text-xs font-semibold text-[var(--muted)]">标题评价 (★{report.titleCaption.titleFeedback.rating}):</div>
                  <ul className="list-disc pl-4">{report.titleCaption.titleFeedback.issues.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                  <div className="mt-1 text-xs font-semibold text-[var(--muted)]">重写候选:</div>
                  <ul className="list-disc pl-4">{report.titleCaption.titleFeedback.rewrites.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
              {report.titleCaption.captionFeedback && (
                <div>
                  <div className="text-xs font-semibold text-[var(--muted)]">文案评价 (★{report.titleCaption.captionFeedback.rating}):</div>
                  <ul className="list-disc pl-4">{report.titleCaption.captionFeedback.issues.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </DimensionCard>

        <DimensionCard title="封面" error={report.cover?.error}>
          {report.cover?.mode === 'evaluate' && report.cover.feedback && (
            <>
              <div className="text-sm">评分 ★{report.cover.feedback.rating}</div>
              <ul className="list-disc pl-4 text-sm">{report.cover.feedback.issues.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
              <div className="mt-1 text-xs font-semibold text-[var(--muted)]">建议:</div>
              <ul className="list-disc pl-4 text-sm">{report.cover.feedback.suggestions.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
            </>
          )}
          {report.cover?.mode === 'generate' && (
            <CoverCandidates
              analysisId={analysisId}
              count={coverCandidateCount}
              recommendedIdx={report.cover.recommendedIdx}
              reasons={report.cover.candidates}
            />
          )}
        </DimensionCard>
      </div>
    </div>
  );
}
