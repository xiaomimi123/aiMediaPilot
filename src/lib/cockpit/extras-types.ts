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
  /** 用户绑定的首个平台账号 (无绑定 → null); 二期 T5 状态条 + 手动同步用。 */
  account: {
    nickname: string;
    loginStatus: string;
    followerCount: number;
    lastSyncAt: string | null;
    lastAutoSyncAt: string | null;
  } | null;
  /** 设置视图「内容基准」卡: baseline 当前值 + retro median 提示。 */
  settings: {
    baselinePlays: string | null;
    retroMedian: number | null;
    retroCount: number;
  };
};
