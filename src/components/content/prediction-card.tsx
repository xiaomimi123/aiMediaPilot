import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatPlays } from '@/lib/prediction/formula';
import type { PredictedPlaysRange } from '@/lib/prediction/types';

const CONFIDENCE_BADGE: Record<PredictedPlaysRange['confidence'], { label: string; cls: string; hint: string }> = {
  low: {
    label: '置信度: 低',
    cls: 'bg-[var(--surface-soft)] text-[var(--muted)]',
    hint: '复盘 3+ 解锁中等',
  },
  medium: {
    label: '置信度: 中',
    cls: 'bg-blue-100 text-blue-900',
    hint: '复盘 10+ 解锁高',
  },
  high: {
    label: '置信度: 高',
    cls: 'bg-green-100 text-green-900',
    hint: '',
  },
};

const SOURCE_LABEL: Record<PredictedPlaysRange['basisSource'], string> = {
  onboarding: '你 onboarding 填的',
  'retro-median': '你最近复盘中位数',
};

export function PredictionCard({ data }: { data: PredictedPlaysRange | null | undefined }) {
  if (!data) {
    return (
      <Card className="border-[var(--line)] bg-[var(--panel-bg)]">
        <CardContent className="space-y-3 pt-6">
          <h3 className="font-semibold">💡 L1 播放预测暂未生成</h3>
          <ul className="space-y-1 text-sm text-[var(--muted)]">
            <li>• 设了账号基线 → 上传时立即出预测</li>
            <li>• 没设的话, 等 3 条复盘后会自动从实测数据反算出基线</li>
          </ul>
          <Link href="/?view=settings">
            <Button size="sm" variant="outline">设置基线 →</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const badge = CONFIDENCE_BADGE[data.confidence];

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <h3 className="font-semibold">📈 预估播放</h3>
        <div className="flex items-baseline justify-center gap-3">
          <span className="text-3xl font-bold tabular-nums">{formatPlays(data.lower)}</span>
          <span className="text-[var(--muted)]">—</span>
          <span className="text-3xl font-bold tabular-nums">{formatPlays(data.upper)}</span>
        </div>
        <div className="flex items-center justify-center gap-2 text-sm">
          <span className="text-[var(--muted)]">中心估算 {formatPlays(data.predicted)}</span>
          <span className="text-[var(--muted)]">·</span>
          <span className={cn('rounded px-2 py-0.5 text-xs font-semibold', badge.cls)}>
            {badge.label}
          </span>
          {badge.hint && <span className="text-xs text-[var(--muted)]">({badge.hint})</span>}
        </div>
        <div className="text-center text-xs text-[var(--muted)]">
          基线 {formatPlays(data.basisValue)} ({SOURCE_LABEL[data.basisSource]}) ·{' '}
          <Link href="/?view=settings" className="hover:text-primary underline-offset-2 hover:underline">
            修改 →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
