export const STAGE_LABEL: Record<string, string> = { topic: '选题', hook: '开头钩子', opening: '开头', middle: '中段', ending: '收尾', interaction: '互动', title: '标题' };

export interface LessonView {
  id: string;
  text: string;
  stage: string;
  stageLabel: string;
  status: string;
  evidenceCount: number;
  contradicted: boolean;
  confirmedAt: string | null;
}

export function toLessonView(r: { id: string; text: string; stage: string; status: string; evidence: unknown; contradicted: boolean; confirmedAt: Date | null }): LessonView {
  return {
    id: r.id,
    text: r.text,
    stage: r.stage,
    stageLabel: STAGE_LABEL[r.stage] ?? r.stage,
    status: r.status,
    evidenceCount: Array.isArray(r.evidence) ? r.evidence.length : 0,
    contradicted: r.contradicted,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
  };
}
