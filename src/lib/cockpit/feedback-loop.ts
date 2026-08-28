/**
 * 三层反馈回路的状态(v5 阶段 E3)。
 *
 * 这个产品的骨架不是十二个并列的功能, 是一条回路:
 *
 * - **快回路(秒级)**: 写稿时时长偏差 / 幕结构 / 简洁度实时校验 —— 只依赖写稿本身
 * - **中回路(48 小时)**: 发布后回采完播与互动, 更新钩子与选题类型的表现
 * - **慢回路(月级)**: 够样本后重拟合评分权重, 高表现内容换进 prompt 样本
 *
 * 三层是**串联**不是并列: 慢回路等中回路, 中回路等发布。把它们画成三个并列的
 * 状态灯会让人以为可以单独修某一层 —— 实际上不把发布链路打通, 后两层永远是死的。
 */

/** 重拟合权重需要的最少「已发布 + 已回采」样本数。 */
export const CALIBRATION_MIN_SAMPLES = 30;

export interface LoopLayer {
  key: 'fast' | 'mid' | 'slow';
  label: string;
  period: string;
  what: string;
  state: 'running' | 'waiting' | 'idle';
  /** 在等谁。running 时为 null。 */
  waitingFor: string | null;
}

export function buildLoopStatus(input: {
  scriptCount: number;
  publishedCount: number;
  /** 已回采到真实表现数据的条数。 */
  measuredCount: number;
}): LoopLayer[] {
  const { scriptCount, publishedCount, measuredCount } = input;

  const fast: LoopLayer = {
    key: 'fast',
    label: '快回路',
    period: '秒级',
    what: '写稿时的时长偏差、幕结构、简洁度实时校验，改一个字分数就动。',
    state: scriptCount > 0 ? 'running' : 'idle',
    waitingFor: scriptCount > 0 ? null : '还没有稿子',
  };

  const mid: LoopLayer = {
    key: 'mid',
    label: '中回路',
    period: '48 小时',
    what: '发布后回采完播与互动，更新钩子和选题类型的真实表现记录。',
    state: measuredCount > 0 ? 'running' : 'waiting',
    waitingFor:
      measuredCount > 0
        ? null
        : publishedCount === 0
          ? '等发布第一条（当前发布 0 条）'
          : `等回采（已发布 ${publishedCount} 条，回采 0 条）`,
  };

  const enough = measuredCount >= CALIBRATION_MIN_SAMPLES;
  const slow: LoopLayer = {
    key: 'slow',
    label: '慢回路',
    period: '月级',
    what: `攒够 ${CALIBRATION_MIN_SAMPLES} 条对照后重拟合评分权重，并把高表现内容换进写稿 prompt 的样本。`,
    state: enough ? 'running' : 'waiting',
    waitingFor: enough
      ? null
      : measuredCount === 0
        ? '等中回路（它还没开始转）'
        : `还差 ${CALIBRATION_MIN_SAMPLES - measuredCount} 条对照样本`,
  };

  return [fast, mid, slow];
}
