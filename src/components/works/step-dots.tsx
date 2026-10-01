import type { StepState } from '@/lib/overview/steps';
import { cn } from '@/lib/utils';

/** 卡片上的迷你六步条 */
export function StepDots({ steps }: { steps: StepState[] }) {
  return (
    <div className="flex gap-1" aria-label={`进度：${steps.filter((s) => s.done).length}/6`}>
      {steps.map((s) => (
        <span key={s.key} title={s.label} className={cn('h-1.5 flex-1 rounded-full', s.done ? 'bg-[var(--chart)]' : s.current ? 'bg-[var(--accent-border)]' : 'bg-[var(--bg-elevated)]')} />
      ))}
    </div>
  );
}
