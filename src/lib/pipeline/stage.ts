/**
 * 内容管线阶段 — 全部按现有数据派生, 不落库 (spec §2.1)。
 * 判定唯一入口; UI / API 不得内联复制规则。
 * 缺失数据 (analysis 被删导致悬空) 一律降级到更早阶段, 不抛错。
 *
 * 与 cockpit 平台阶段流 (src/lib/cockpit/platform-stages.ts) 的关系: 这里的 5 阶段是
 * picked/analysis/distribution 驱动的粗粒度视图, 与 CockpitContent 的 8 阶段(细粒度、按平台走
 * nextStageFor 推进)是两套独立判定——READY 只表示"已定稿", 不预设定稿后一定进入 recording:
 * 九期起 CockpitContent 的定稿推进按平台走 (小红书 script→publishing, 直接跳过录制/剪辑),
 * 本模块的 READY→'定稿待拍' 标签沿用旧措辞是为了兼容仍以录制为主的平台, 不代表所有平台都要拍。
 */
export type PipelineStage = 'DRAFTING' | 'READY' | 'SHOT' | 'PUBLISHED' | 'RETROED';

export interface StageInput {
  /** ScriptDraft.picked — null = 未定稿 */
  picked: unknown;
  /** 关联 ContentAnalysis 摘要; analysisId 悬空或无 analysis 时传 null */
  analysis: { publishedAt: Date | string | null; retroStatus: string | null } | null;
  /** Distribution 记录数 */
  distributionCount: number;
}

export function deriveStage(input: StageInput): PipelineStage {
  const { picked, analysis, distributionCount } = input;
  if (analysis?.retroStatus === 'COMPLETED') return 'RETROED';
  if (analysis?.publishedAt != null || distributionCount > 0) return 'PUBLISHED';
  if (analysis != null) return 'SHOT';
  if (picked != null) return 'READY';
  return 'DRAFTING';
}

export const STAGE_LABEL: Record<PipelineStage, string> = {
  DRAFTING: '草稿',
  READY: '定稿待拍',
  SHOT: '已拍待发',
  PUBLISHED: '已发布',
  RETROED: '已复盘',
};
