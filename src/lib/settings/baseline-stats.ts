/**
 * baseline 相关的纯统计逻辑, 从 `src/app/settings/baseline/page.tsx` 抽出,
 * 供该页与 cockpit extras (`src/lib/cockpit/extras.ts`) 共用——两处都要展示
 * "retro median 是否已经足够覆盖手填 baseline" 的判断依据。
 */

export const MIN_RETROS_FOR_MEDIAN = 3;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * 输入用户所有 ActualMetric.plays (已转 number), 输出:
 *  - retroCount: 复盘条数
 *  - retroMedian: 条数 ≥ MIN_RETROS_FOR_MEDIAN 时的四舍五入 median, 否则 null
 *    (冷启动态: 数据太少时不给自动值, 避免个别极端值误导)
 */
export function computeRetroStats(plays: number[]): {
  retroMedian: number | null;
  retroCount: number;
} {
  const retroCount = plays.length;
  const retroMedian =
    retroCount >= MIN_RETROS_FOR_MEDIAN ? Math.round(median(plays) ?? 0) : null;
  return { retroMedian, retroCount };
}
