'use client';

import { ROLE_LABEL } from '@/lib/script/model';
import type { PolishResult } from '@/lib/script/polish';

/** 润色结果: 6 段润色稿、改动清单、需要确认的地方、新加的片段。「我自己写了一篇」和脚本步「润色」共用。 */
export function PolishPanel({ result, useLabel, keepLabel, onUse, onKeep, busy = false }: { result: PolishResult; useLabel: string; keepLabel: string; onUse: () => void; onKeep: () => void; busy?: boolean }) {
  const over = Math.round((result.report.totalSec - result.report.totalLimitSec) * 10) / 10;
  return (
    <div className="space-y-3 rounded-[var(--r-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b>润色稿</b>
        <span className="font-mono text-xs text-[var(--text-tertiary)]">{`约 ${result.report.totalSec} 秒 / 目标 ${result.report.targetSec} 秒`}</span>
        {!result.report.ok && <span className="text-xs text-[var(--warning)]">{`仍超出 ${over} 秒`}</span>}
      </div>
      <div className="space-y-1">
        {result.script.segments.map((s) => (
          <p key={s.id}>
            <span className="mr-1 text-xs text-[var(--text-tertiary)]">{ROLE_LABEL[s.role]}</span>
            <span>{s.text}</span>
          </p>
        ))}
      </div>
      {result.added.length > 0 && (
        <div className="rounded-[var(--r-md)] bg-[var(--warning-subtle)] p-2">
          <p className="text-xs text-[var(--warning)]">这几处是新加的，确认一下：</p>
          <ul className="list-disc pl-5">
            {result.added.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="mb-1 text-xs text-[var(--text-tertiary)]">{`改了什么（${result.changes.length} 处）`}</p>
        {result.changes.length === 0 ? (
          <p className="text-[var(--text-secondary)]">没有改动。</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-5">
            {result.changes.map((c, i) => (
              <li key={i}>{`${c.kind}：${c.what}`}</li>
            ))}
          </ul>
        )}
      </div>
      {result.questions.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-[var(--text-tertiary)]">需要你确认的地方</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {result.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy} onClick={onUse}>
          {useLabel}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={onKeep}>
          {keepLabel}
        </button>
      </div>
    </div>
  );
}
