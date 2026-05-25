'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const STEPS = ['选平台', '网络', '登录', '完成'] as const;
type Step = 0 | 1 | 2 | 3;

export interface WizardState {
  platform?: 'XIAOHONGSHU' | 'DOUYIN';
  proxy?: import('@/lib/proxy').ProxyConfig | null;
  sessionId?: string;
  accountId?: string;
}

export function Wizard({ children }: { children: (props: {
  step: Step;
  state: WizardState;
  update: (partial: Partial<WizardState>) => void;
  next: (partial?: Partial<WizardState>) => void;
  prev: () => void;
}) => React.ReactNode }) {
  const [step, setStep] = useState<Step>(0);
  const [state, setState] = useState<WizardState>({});

  return (
    <div className="space-y-6">
      <ol className="flex items-center gap-2 text-sm">
        {STEPS.map((label, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs',
              i < step ? 'bg-primary text-primary-foreground' :
              i === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}>
              {i < step ? '✓' : i + 1}
            </span>
            <span className={cn(i === step ? 'font-semibold' : 'text-muted-foreground')}>{label}</span>
            {i < STEPS.length - 1 && <span className="text-muted-foreground">→</span>}
          </li>
        ))}
      </ol>
      {children({
        step,
        state,
        update: (partial) => setState((s) => ({ ...s, ...partial })),
        next: (partial = {}) => { setState((s) => ({ ...s, ...partial })); setStep((s) => Math.min(3, s + 1) as Step); },
        prev: () => setStep((s) => Math.max(0, s - 1) as Step),
      })}
    </div>
  );
}
