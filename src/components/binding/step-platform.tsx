'use client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const PLATFORMS = [
  { id: 'XIAOHONGSHU' as const, emoji: '🔴', label: '小红书', desc: '图文笔记 · 视频' },
  { id: 'DOUYIN' as const, emoji: '⚫', label: '抖音', desc: '短视频 (Plan 2)', disabled: true },
];

export function StepPlatform({
  selected, onSelect, onNext,
}: { selected?: 'XIAOHONGSHU' | 'DOUYIN'; onSelect: (id: 'XIAOHONGSHU' | 'DOUYIN') => void; onNext: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">选择平台</h2>
      <div className="grid grid-cols-2 gap-3">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={p.disabled}
            onClick={() => onSelect(p.id)}
            className={cn(
              'rounded-lg border bg-card p-6 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
              selected === p.id ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:bg-accent'
            )}
          >
            <div className="text-3xl">{p.emoji}</div>
            <div className="mt-2 font-semibold">{p.label}</div>
            <div className="text-sm text-muted-foreground">{p.desc}</div>
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <Button disabled={!selected} onClick={onNext}>下一步 →</Button>
      </div>
    </div>
  );
}
