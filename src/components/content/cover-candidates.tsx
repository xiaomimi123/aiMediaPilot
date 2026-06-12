'use client';

export function CoverCandidates({
  analysisId,
  count,
  recommendedIdx,
  reasons,
}: {
  analysisId: string;
  count: number;
  recommendedIdx?: number;
  reasons?: { coverCandidateIdx: number; reason: string }[];
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {Array.from({ length: count }, (_, i) => {
        const isRecommended = i === recommendedIdx;
        const reason = reasons?.find((r) => r.coverCandidateIdx === i)?.reason;
        return (
          <div key={i} className={`relative rounded-md border ${isRecommended ? 'border-primary ring-2 ring-primary/30' : 'border-border'} p-1`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/v1/content/analyses/${analysisId}/cover/${i}`} alt={`候选 ${i + 1}`} className="aspect-video w-full rounded object-cover" />
            {isRecommended && <div className="absolute right-1 top-1 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">推荐</div>}
            {reason && <div className="mt-1 text-xs text-muted-foreground">{reason}</div>}
          </div>
        );
      })}
    </div>
  );
}
