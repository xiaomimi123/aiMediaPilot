/**
 * "extras" 是随 WorkspaceState 一起下发、但不属于可持久化 state 本身的衍生数据——
 * 服务端算好直接推给前端, 前端不回写。Task 13 会实现 predictions 的真实计算
 * (基于 L1 baseline / retro median), 本 Task 只落契约类型 + 占位实现。
 */
export type CockpitExtras = {
  predictions: Record<
    string,
    { lower: number; upper: number; predicted: number; actualPlays: number | null }
  >;
};
