/**
 * Douyin 创作中心的 postedAt 字段是 Beijing local 时间字符串, 无时区后缀,
 * 常见形态: `2026-07-05 12:30` (无秒) 或 `2026-07-05 12:30:45` (含秒)。
 *
 * 之前的实现 `input.replace(' ', 'T') + ':00'`:
 *   - `2026-07-05 12:30`     → `2026-07-05T12:30:00` (无 TZ) → 被 JS 当作 *local*
 *     time, 服务器在 UTC 时 `.getTime()` = 12:30 UTC = 20:30 Beijing, 差 8h.
 *   - `2026-07-05 12:30:45`  → `2026-07-05T12:30:45:00` (多一个 `:00`) → NaN,
 *     调用方走 `?? new Date()` 兜底, publishedAt 直接变 "现在", 触发的 retro
 *     snapshot 提前 8h 抓 metric, 破坏 dashboard calibration/biggestMisses.
 *
 * 修法: 分离 date + time, 补齐秒, 显式拼 `+08:00` 后缀作为 Beijing 时区。
 */
export function parseLooseBeijingTime(input: string): Date | null {
  if (!input) return null;
  const trimmed = input.trim();
  // 期望格式: YYYY-MM-DD [HH:MM(:SS)?]
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?)$/);
  if (!m) return null;
  const [, date, timeRaw] = m;
  const hasSeconds = timeRaw.split(':').length === 3;
  const time = hasSeconds ? timeRaw : `${timeRaw}:00`;
  const iso = `${date}T${time}+08:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
