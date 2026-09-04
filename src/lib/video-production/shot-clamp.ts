/**
 * 三十期 Task 3 预备提交：从 `director-prompt.ts`（旧渲染层，随本期删除）挪出。
 * `clampShotsToSource` 是纯泛型函数，新链（`handleTalkingHeadBrollRemotion` 等）
 * 仍在用它做渲染前的最后一道裁剪防线，不随旧链一起删。
 */

/**
 * 裁完短于这个就没意义了。
 *
 * 与 `film-plan-timing.ts` 的 `BROLL_MIN_SHOT_MS`(=1200, `checkBrollPlanTiming`
 * 在 FilmPlan 修复循环里用)不是同一件事、数值也故意不同, 别当成对不上的 bug
 * 误改成一致: 这里是**裁剪之后**"短于此就整镜丢弃"的硬下限, `BROLL_MIN_SHOT_MS`
 * 是**裁剪之前**"引导模型别排太短的镜"的软标准, 前者故意比后者松(1000 < 1200)——
 * 一镜从 FilmPlan 产出时的 1200ms 被这个函数按素材时长夹小到比如 1050ms 是正常的
 * "因裁剪而缩短、但仍然可用", 如果两个阈值相等, 这种镜头会在这里被误杀。
 */
const MIN_SHOT_MS = 1000;

/**
 * 把导演/分镜给的镜头裁回素材长度之内。
 *
 * **真实事故**: 出镜素材 155 秒, 导演却排出 234 秒的分镜(s7 从 155 秒开始、s8 到
 * 234 秒结束), 合成时照单全收地拼起来 —— 成片比素材长了 79 秒, 后面那 79 秒既没有
 * 人声也没有对应台词, 纯粹是凑出来的画面。
 *
 * 同一份稿子上一轮导演给的是 0~154 秒, 完全正常。所以这是模型的随机性, 而管线
 * **一条校验都没有**: 分镜是 LLM 出的, 出格是迟早的事, 不该指望它每次都对。
 *
 * 素材时长拿不到时**原样返回**: 宁可不裁, 也不要凭空裁错 —— 裁错会直接丢掉真实内容。
 */
export function clampShotsToSource<T extends { startMs: number; endMs: number }>(
  shots: T[],
  sourceDurationMs: number | undefined,
): T[] {
  if (!sourceDurationMs || sourceDurationMs <= 0) return shots;

  return shots
    .filter((s) => s.startMs < sourceDurationMs)
    .map((s) => (s.endMs > sourceDurationMs ? { ...s, endMs: sourceDurationMs } : s))
    .filter((s) => s.endMs - s.startMs >= MIN_SHOT_MS);
}
