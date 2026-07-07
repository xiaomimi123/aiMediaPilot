'use client';
import { Card, CardContent } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import type { TrendPoint } from '@/lib/dashboard/types';

function formatXLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// partial 数据点画空心圆环, 全维度数据点画实心圆 — 用户能一眼看清哪些分是"3/4 或 2/4 维度算的"
function TrendDot(props: {
  cx?: number;
  cy?: number;
  stroke?: string;
  payload?: { partial?: boolean };
}) {
  const { cx, cy, stroke, payload } = props;
  if (cx == null || cy == null) return null;
  const partial = payload?.partial === true;
  return partial ? (
    <circle cx={cx} cy={cy} r={4} fill="#fff" stroke={stroke} strokeWidth={1.5} />
  ) : (
    <circle cx={cx} cy={cy} r={4} fill={stroke} stroke={stroke} />
  );
}

export function OverallScoreTrend({ trend }: { trend: TrendPoint[] }) {
  const chartData = trend.map((p) => ({
    label: formatXLabel(p.completedAt),
    filename: p.videoFilename,
    overallScore: p.overallScore,
    inferredActualScore: p.inferredActualScore,
    partial: p.partial,
  }));

  const partialCount = trend.filter((p) => p.partial).length;

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
          <>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                  <XAxis dataKey="label" stroke="#888" fontSize={12} />
                  <YAxis domain={[0, 100]} stroke="#888" fontSize={12} />
                  <Tooltip
                    formatter={(value) => (value == null ? '—' : (value as number | string))}
                    labelFormatter={(_, payload) => {
                      const p = payload?.[0]?.payload as { filename?: string; partial?: boolean } | undefined;
                      return `${p?.filename ?? ''}${p?.partial ? ' *(部分维度)' : ''}`;
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line
                    type="monotone"
                    dataKey="overallScore"
                    name="预判 overallScore"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={<TrendDot />}
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
            {partialCount > 0 && (
              <div className="text-[11px] text-muted-foreground">
                空心圆 = 部分维度评估 ({partialCount} 条), 未参与 niche 均值与 top 排名
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
