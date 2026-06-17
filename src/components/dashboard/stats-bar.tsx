import { Card, CardContent } from '@/components/ui/card';
import { BarChart3, Wallet, CalendarDays, RotateCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Stats {
  totalAnalyses: number;
  totalSpendUSD: number;
  last7dCount: number;
  retroedCount: number;
}

export function StatsBar({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat icon={BarChart3} label="总分析" value={stats.totalAnalyses.toLocaleString()} tint="blue" />
      <Stat icon={Wallet} label="总花费" value={`$${stats.totalSpendUSD.toFixed(3)}`} tint="purple" />
      <Stat icon={CalendarDays} label="7 天上传" value={stats.last7dCount.toLocaleString()} tint="green" />
      <Stat icon={RotateCw} label="已复盘" value={stats.retroedCount.toLocaleString()} tint="amber" />
    </div>
  );
}

const TINTS = {
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
} as const;

function Stat({
  icon: Icon,
  label,
  value,
  tint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tint: keyof typeof TINTS;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', TINTS[tint])}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
