/**
 * "extras" 是随 WorkspaceState 一起下发、但不属于可持久化 state 本身的衍生数据——
 * 服务端算好直接推给前端, 前端不回写。predictions 由 loadExtras 计算
 * (基于 ContentAnalysis.report 的 predictedPlaysRange + 最新 ActualMetric)。
 */
export type CockpitExtras = {
  predictions: Record<
    string,
    { lower: number; upper: number; predicted: number; actualPlays: number | null }
  >;
};
