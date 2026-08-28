import type { LoopLayer } from '@/lib/cockpit/feedback-loop';
import { cn } from '@/lib/utils';

const STATE_LABEL: Record<LoopLayer['state'], string> = {
  running: '运行中',
  waiting: '等待中',
  idle: '未开始',
};

/**
 * 三层反馈回路。
 *
 * 竖着串起来而不是三张并排的卡: 它们是**串联**关系 —— 慢回路等中回路, 中回路等
 * 发布。并排画会让人以为可以单独修某一层。
 */
export function LoopStatus({ layers }: { layers: LoopLayer[] }) {
  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="text-sm font-medium">三层反馈回路</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {layers.filter((l) => l.state === 'running').length} / {layers.length} 运行中。
        三层是串联的，不打通前一层，后面的永远是死的。
      </p>

      <ol className="mt-3 flex flex-col">
        {layers.map((l, i) => (
          <li key={l.key} className="relative pl-5">
            {/* 竖线把三层串起来, 最后一层不画 */}
            {i < layers.length - 1 ? (
              <span className="absolute left-[5px] top-4 h-full w-px bg-border" aria-hidden />
            ) : null}
            <span
              className={cn(
                'absolute left-0 top-[6px] h-2.5 w-2.5 rounded-full',
                l.state === 'running' ? 'bg-primary' : 'bg-muted-foreground/30',
              )}
              aria-hidden
            />
            <div className="pb-4">
              <p className="text-sm">
                {l.label}
                <span className="ml-2 text-xs text-muted-foreground">{l.period}</span>
                <span
                  className={cn(
                    'ml-2 rounded px-1.5 py-0.5 text-xs',
                    l.state === 'running' ? 'bg-secondary' : 'text-muted-foreground',
                  )}
                >
                  {STATE_LABEL[l.state]}
                </span>
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{l.what}</p>
              {l.waitingFor ? (
                <p className="mt-0.5 text-xs text-destructive">{l.waitingFor}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
