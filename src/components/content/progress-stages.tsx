import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

const STAGES = [
  { key: 'QUEUED', label: '排队中' },
  { key: 'PREPROCESSING', label: '预处理 (抽帧/转写)' },
  { key: 'ANALYZING', label: 'AI 分析中' },
  { key: 'COMPLETED', label: '完成' },
];

export function ProgressStages({ status, errorMessage }: { status: string; errorMessage?: string | null }) {
  const isFailed = status === 'FAILED' || status === 'CANCELLED';
  const idx = STAGES.findIndex((s) => s.key === status);
  const pctMap: Record<string, number> = { QUEUED: 5, PREPROCESSING: 30, ANALYZING: 70, COMPLETED: 100 };
  const pct = pctMap[status] ?? (isFailed ? 50 : 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        {STAGES.map((s, i) => (
          <span
            key={s.key}
            className={cn(
              'rounded-full px-3 py-1',
              isFailed && i <= idx ? 'bg-destructive/10 text-destructive' :
              i < idx ? 'bg-primary/20 text-primary' :
              i === idx ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}
          >
            {s.label}
          </span>
        ))}
      </div>
      <Progress value={pct} />
      {errorMessage && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{errorMessage}</div>}
    </div>
  );
}
