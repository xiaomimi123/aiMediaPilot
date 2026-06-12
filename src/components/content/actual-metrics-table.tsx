type Metric = {
  plays: string | number;
  likes: string | number;
  comments: string | number;
  shares: string | number;
  collects: string | number;
  completionRateBp: number | null;
  retention3sBp: number | null;
  followConversionBp: number | null;
  snapshotAt: string;
  daysAfterPublish: number;
};

function bpToPercent(bp: number | null): string {
  if (bp === null) return '—';
  return `${(bp / 100).toFixed(1)}%`;
}

function formatBig(v: string | number): string {
  const n = typeof v === 'string' ? Number(v) : v;
  return n.toLocaleString();
}

export function ActualMetricsTable({ metric }: { metric: Metric }) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        T+{metric.daysAfterPublish.toFixed(1)} 天采集 · {new Date(metric.snapshotAt).toLocaleString()}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="播放" value={formatBig(metric.plays)} />
        <Stat label="点赞" value={formatBig(metric.likes)} />
        <Stat label="评论" value={formatBig(metric.comments)} />
        <Stat label="转发" value={formatBig(metric.shares)} />
        <Stat label="收藏" value={formatBig(metric.collects)} />
        <Stat label="完播率" value={bpToPercent(metric.completionRateBp)} />
        <Stat label="3s 留存" value={bpToPercent(metric.retention3sBp)} />
        <Stat label="转粉率" value={bpToPercent(metric.followConversionBp)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
