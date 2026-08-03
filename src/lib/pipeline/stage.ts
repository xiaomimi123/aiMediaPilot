/**
 * 内容管线阶段 — 全部按现有数据派生, 不落库 (spec §2.1)。
 * 判定唯一入口; UI / API 不得内联复制规则。
 * 缺失数据 (analysis 被删导致悬空) 一律降级到更早阶段, 不抛错。
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
