'use client';

import type { StepKey, StepState } from '@/lib/overview/steps';
import { cn } from '@/lib/utils';

export function StepBar({ steps, active, onSelect }: { steps: StepState[]; active: StepKey; onSelect: (k: StepKey) => void }) {
  return (
    <div role="tablist" className="flex gap-2 overflow-x-auto pb-1">
      {steps.map((s) => (
        <button
          key={s.key}
          role="tab"
          aria-selected={active === s.key}
          aria-current={s.current ? 'step' : undefined}
          aria-label={s.label}
          onClick={() => onSelect(s.key)}
          className={cn(
            'shrink-0 rounded-full px-3 py-1 text-sm',
            active === s.key ? 'bg-[var(--accent)] font-semibold text-[var(--text-on-accent)]' : s.done ? 'bg-[var(--accent-border)] text-[var(--accent)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
            // 项目实际走到的一步: 选了别的步骤时仍用橙色描边标出来
            s.current && active !== s.key && 'ring-2 ring-inset ring-[var(--accent)] text-[var(--accent)]',
          )}
        >
          {s.done && active !== s.key ? `✓ ${s.label}` : s.label}
        </button>
      ))}
    </div>
  );
}
