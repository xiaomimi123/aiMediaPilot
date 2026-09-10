/**
 * 三十八期: 「今天是规划第几天」的纯函数。ContentPlanDay 不冗余存日期 —— 实际日期
 * = startDate + dayIndex, 存日期会导致规划 startDate 改动/时区漂移时两处各自算出
 * 不一致的结果。today 显式传入(不内取 Date.now), 便于测试且调用方可传服务器/客户端
 * 的任意"今天"定义。
 *
 * @param startDate "YYYY-MM-DD" — 规划第一天(dayIndex=1)
 * @param today "YYYY-MM-DD" — 要查询的日期
 * @param totalDays 规划总天数, 超出 [1, totalDays] 返回 null
 * @returns 1-based dayIndex, 或 null(今天在规划范围之外)
 */
export function dayIndexFor(startDate: string, today: string, totalDays: number): number | null {
  const start = new Date(`${startDate}T00:00:00Z`);
  const cur = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(cur.getTime())) return null;

  const diffDays = Math.round((cur.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  const dayIndex = diffDays + 1;

  if (dayIndex < 1 || dayIndex > totalDays) return null;
  return dayIndex;
}
