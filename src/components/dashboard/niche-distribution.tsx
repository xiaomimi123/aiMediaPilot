import { Card, CardContent } from '@/components/ui/card';
import type { NicheRow } from '@/lib/dashboard/types';

export function NicheDistribution({ rows }: { rows: NicheRow[] }) {
  const hasDashRow = rows.some((r) => r.avgOverallScore === null);
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <h3 className="font-semibold">📂 内容垂类</h3>
        {rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">无数据</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-left">垂类</th>
                  <th className="py-2 text-right">条数</th>
                  <th className="py-2 text-right">平均分</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.niche} className="border-b">
                    <td className="py-2">{r.label}</td>
                    <td className="py-2 text-right tabular-nums">{r.count}</td>
                    <td className="py-2 text-right tabular-nums">
                      {r.avgOverallScore !== null ? Math.round(r.avgOverallScore) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasDashRow && (
              <div className="text-[11px] text-muted-foreground">
                平均分 "—" = 该 niche 下暂无 4 维全通过的分析 (partial 已排除以保 comparable)
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
