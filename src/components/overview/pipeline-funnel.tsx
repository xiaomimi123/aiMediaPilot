import type { PipelineStage } from '@/lib/cockpit/overview';
import { cn } from '@/lib/utils';

/**
 * 内容管线漏斗。**断点标在断的那一环上**, 后面的 0 不重复标红 ——
 * 它们是后果不是新问题, 全标红会让人不知道该先修哪个。
 */
export function PipelineFunnel({ stages }: { stages: PipelineStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="text-sm font-medium">内容管线</h2>
      <ul className="mt-3 flex flex-col gap-2.5">
        {stages.map((s) => (
          <li key={s.key}>
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">{s.label}</span>
              <div className="h-5 flex-1 overflow-hidden rounded bg-secondary">
                <div
                  className={cn('flex h-full items-center rounded px-2', s.broken ? 'bg-destructive' : 'bg-primary')}
                  style={{ width: `${Math.max(3, (s.count / max) * 100)}%` }}
                >
                  <span className="text-xs font-medium tabular-nums text-primary-foreground">{s.count}</span>
                </div>
              </div>
            </div>
            {s.conversion !== null ? (
              <p className="ml-[76px] mt-0.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{(s.conversion * 100).toFixed(0)}%</span>
                {s.broken ? <span className="ml-2 text-destructive">链路断在这里</span> : null}
                {s.bypassed ? <span className="ml-2">这一环被绕过（稿子没走选题池）</span> : null}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
