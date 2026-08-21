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
  /** 全局最近一次自动同步时间 (不区分账号); 状态条 + 手动同步用。
   *  十七期: 账号绑定功能整体移除, 原本挂在这里的 nickname/loginStatus/
   *  followerCount/lastSyncAt (来自 PlatformAccount) 一并去掉, 只保留
   *  跟自动同步本身相关的这一个时间戳。 */
  lastAutoSyncAt: string | null;
  /** 设置视图「内容基准」卡: baseline 当前值 + retro median 提示。 */
  settings: {
    baselinePlays: string | null;
    retroMedian: number | null;
    retroCount: number;
  };
};
