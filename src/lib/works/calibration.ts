/**
 * 校准样本(二十三期)。
 *
 * 校准要的是**「预测分 vs 实际表现」的配对**。这个配对一直凑不齐, 但原因不是
 * 「还没发够」—— 是回采回来的作品和库里的稿子之间**根本没有对应关系**。平台
 * 不返回这层信息, 只能由人认领(`PublishedWork.scriptDraftId`)。
 *
 * 在补上那个字段之前, 校准页把样本数硬编码成 0。那个 0 当时是对的, 但它意味着
 * **哪怕你真发了一条系统写的稿子, 校准也永远不会自己接上**。
 */

export interface CalibrationPair {
  workId: string;
  title: string;
  play: number;
  publishedAt: string;
  scriptDraftId: string;
  predictedHard: number;
  hardMax: number;
}

export interface CalibrationReadiness {
  /** 已认领配对数 —— 预测分和实际表现都齐的。 */
  paired: number;
  /** 还差多少条才能重拟合。 */
  missing: number;
  /** 可以认领但还没认领的作品数(公开 + 计入赛道 + 未关联)。 */
  claimable: number;
  ready: boolean;
}

export function assessCalibration(
  pairs: { predictedHard: number | null }[],
  claimable: number,
  minSamples: number,
): CalibrationReadiness {
  // 关联了稿子但那份稿子打不出分(非六幕/还没写)的, 不算有效样本 —— 没有预测分
  // 就没有可对照的东西, 计进去只会让「样本够了」这句话变成谎话。
  const paired = pairs.filter((p) => p.predictedHard !== null).length;
  return {
    paired,
    missing: Math.max(0, minSamples - paired),
    claimable,
    ready: paired >= minSamples,
  };
}
