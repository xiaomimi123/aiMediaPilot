'use client';
import { Card, CardContent } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';

interface TrendPoint {
  id: string;
  videoFilename: string;
  completedAt: string;
  overallScore: number | null;
  inferredActualScore: number | null;
}

function formatXLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function OverallScoreTrend({ trend }: { trend: TrendPoint[] }) {
  const chartData = trend.map((p) => ({
    label: formatXLabel(p.completedAt),
    filename: p.videoFilename,
    overallScore: p.overallScore,
    inferredActualScore: p.inferredActualScore,
  }));

  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">📈 overallScore 趋势</h3>
          <div className="text-xs text-muted-foreground">最近 {trend.length} 条</div>
        </div>
        {trend.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">还没有完成的分析</div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis dataKey="label" stroke="#888" fontSize={12} />
                <YAxis domain={[0, 100]} stroke="#888" fontSize={12} />
                <Tooltip
                  formatter={(value) => (value == null ? '—' : value)}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.filename ?? ''}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line
                  type="monotone"
                  dataKey="overallScore"
                  name="预判 overallScore"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="inferredActualScore"
                  name="实测推算"
                  stroke="#a855f7"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ r: 4 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
