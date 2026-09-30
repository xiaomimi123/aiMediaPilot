import type { Diagnosis, Verdict } from '@/lib/retro/diagnose';

const VERDICT: Record<Verdict, { text: string; cls: string }> = {
  good: { text: '比平时好', cls: 'text-[var(--success)]' },
  even: { text: '和平时差不多', cls: 'text-[var(--text-secondary)]' },
  bad: { text: '比平时差', cls: 'text-[var(--danger)]' },
  na: { text: '', cls: '' },
};

export function DiagnosisView({ diagnosis: d }: { diagnosis: Diagnosis }) {
  const maxView = Math.max(1, ...d.curve.map((c) => c.viewCount ?? 0));
  return (
    <div className="space-y-4 text-sm">
      <ul className="divide-y divide-[var(--border-subtle)] rounded-md border border-[var(--border-subtle)]">
        {d.stages.map((s) => (
          <li key={s.key} className="px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{s.label}</span>
              {s.verdict !== 'na' && <span className={`text-xs ${VERDICT[s.verdict].cls}`}>{VERDICT[s.verdict].text}</span>}
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{s.note}</p>
          </li>
        ))}
      </ul>
      {d.benchmark && (
        <p className="text-xs text-[var(--text-secondary)]">{`对标这条是他平时的 ${d.benchmark.theirRatio} 倍，你这条是你平时的 ${d.benchmark.myRatio ?? '?'} 倍`}</p>
      )}
      {d.curve.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-[var(--text-tertiary)]">发布后每天的播放</div>
          <div className="flex items-end gap-2">
            {d.curve.map((c, i) => (
              <div key={c.day} className="flex flex-1 flex-col items-center gap-1">
                <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{c.viewCount ?? '—'}</span>
                <div className="w-full rounded-sm bg-[var(--accent)]" style={{ height: `${Math.max(2, ((c.viewCount ?? 0) / maxView) * 80)}px` }} />
                <span className="text-[10px] text-[var(--text-tertiary)]">{`第 ${i + 1} 天`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
