import { Card, CardContent } from '@/components/ui/card';

interface Stats {
  totalAnalyses: number;
  totalSpendUSD: number;
  last7dCount: number;
  retroedCount: number;
}

export function StatsBar({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat emoji="📊" label="总分析" value={stats.totalAnalyses.toLocaleString()} />
      <Stat emoji="💰" label="总花费" value={`$${stats.totalSpendUSD.toFixed(3)}`} />
      <Stat emoji="📅" label="7 天上传" value={stats.last7dCount.toLocaleString()} />
      <Stat emoji="🔄" label="已复盘" value={stats.retroedCount.toLocaleString()} />
    </div>
  );
}

function Stat({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6">
        <div className="text-xs text-muted-foreground">{emoji} {label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
