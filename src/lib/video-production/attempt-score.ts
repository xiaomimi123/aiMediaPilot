/**
 * 三次不达标时挑哪一版(二十三期)。
 *
 * **动因: 原来的兜底是盲的。** 三次体检都没过之后, 代码会再调一次模型、拿回第四版,
 * 只做结构校验就直接用 —— 那一版从来没被体检过, 完全可能比第二版还差。真实出片里
 * 这条路走过 2 次(日志「三次仍未达标, 放行最后一版」)。
 *
 * 改成**留最好的那一版**: 三次都量过, 谁的分高用谁。顺带省掉一次模型调用。
 *
 * 打分只用来在几个都不合格的版本之间排序, **不是新的合格线** —— 合格与否由那三关
 * 各自判定, 这里回答的是另一个问题: 都不合格时, 哪个最不坏。
 */

export interface AttemptMetrics {
  densityOk: boolean;
  hollowOk: boolean;
  layoutOk: boolean;
  /** 取样帧的平均细节占比。 */
  detailRatio: number;
  /** 取样帧的平均内容占比。 */
  contentRatio: number;
}

/**
 * 给一版打分。
 *
 * 主序是「过了几关」—— 过关数差一关, 比任何细节差异都重要。
 * 同关数时看细节/占比的比值: 那个比值低意味着画面是靠大色块撑的, 见 frame-detail.ts。
 * 比值封顶到 1: 超过 1 只说明画面几乎全是线条, 再高没有意义。
 */
export function scoreAttempt(m: AttemptMetrics): number {
  const passed = (m.densityOk ? 1 : 0) + (m.hollowOk ? 1 : 0) + (m.layoutOk ? 1 : 0);
  const richness = m.contentRatio > 0 ? Math.min(1, m.detailRatio / m.contentRatio) : 0;
  // 再加一点点内容量, 用来把「全空」和「有一点东西」区分开
  return passed * 10 + richness + Math.min(1, m.contentRatio * 2);
}

export interface ScoredAttempt {
  html: string;
  score: number;
}

/**
 * 挑分最高的一版。分数相同取**先出现**的 —— 早一版通常更贴合原始指令,
 * 后面几版是在反馈驱动下越改越偏的产物。
 */
export function pickBestAttempt(attempts: ScoredAttempt[]): string | null {
  if (attempts.length === 0) return null;
  let best = attempts[0];
  for (const a of attempts.slice(1)) if (a.score > best.score) best = a;
  return best.html;
}
