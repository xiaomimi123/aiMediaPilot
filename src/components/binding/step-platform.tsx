'use client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const PLATFORMS = [
  { id: 'XIAOHONGSHU' as const, label: '小红书', desc: '图文笔记 · 视频' },
  { id: 'DOUYIN' as const, label: '抖音', desc: '短视频' },
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
            onClick={() => onSelect(p.id)}
            className={cn(
              'rounded-lg border bg-card p-6 text-left transition-colors',
              selected === p.id ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:bg-accent'
            )}
          >
            <div className="font-semibold">{p.label}</div>
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
