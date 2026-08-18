// 九期: 平台差异化流水线
// 现状: 数据层 ContentStage 8 阶段超集 (inbox/topic/script/recording/editing/
// publishing/review/archived) 不动 (迁移风险); 本模块新增「平台阶段流」视图与推进层——
// 每个平台各自的工作流子集/顺序, 唯一事实来源。纯模块: 零 IO, 零 React。
import { CONTENT_STAGES, STAGE_LABELS, NEXT_ACTIONS, WORK_STAGES, SCHEDULABLE_STAGES } from './model';
import type { ContentStage, WorkStage } from './model';

// 小红书: 纯 AI 图文产线 (七期后) —— 录制/剪辑对它是永远空走的死阶段, 不在流内。
// 配图并入「文案」阶段的抽屉, 不新增阶段值。
export const PLATFORM_STAGE_FLOW: Record<string, WorkStage[]> = {
  xiaohongshu: ['inbox', 'topic', 'script', 'publishing', 'review'],
  // 其余平台 (douyin/bilibili/x/youtube/gongzhonghao) 与未知平台不列 —— 走 DEFAULT。
};

// 现状 7 阶段 (WORK_STAGES), 未收录进 PLATFORM_STAGE_FLOW 的平台一律回落到这里。
export const DEFAULT_STAGE_FLOW: WorkStage[] = WORK_STAGES;

export function stageFlowFor(platform: string, deliveryMode?: 'manual' | 'ai-faceless'): WorkStage[] {
  if (deliveryMode === 'ai-faceless') return ['inbox', 'topic', 'script', 'editing', 'publishing', 'review'];
  return PLATFORM_STAGE_FLOW[platform] ?? DEFAULT_STAGE_FLOW;
}

export function stageLabelFor(platform: string, stage: ContentStage): string {
  if (platform === 'xiaohongshu' && stage === 'script') return '文案';
  return STAGE_LABELS[stage];
}

export function nextActionFor(platform: string, stage: ContentStage): string {
  if (platform === 'xiaohongshu' && stage === 'script') return '完成文案与配图';
  return NEXT_ACTIONS[stage];
}

export function isStageInFlow(platform: string, stage: ContentStage, deliveryMode?: 'manual' | 'ai-faceless'): boolean {
  if (stage === 'archived') return false; // archived 不在任何 flow (flow 是 WorkStage[])
  return stageFlowFor(platform, deliveryMode).includes(stage as WorkStage);
}

export function nextStageFor(platform: string, stage: ContentStage, deliveryMode?: 'manual' | 'ai-faceless'): ContentStage | null {
  const flow = stageFlowFor(platform, deliveryMode);
  if (isStageInFlow(platform, stage, deliveryMode)) {
    const idx = flow.indexOf(stage as WorkStage);
    // 流尾 (含 review, 各平台流终点均为 review) → null: 同现状边界, 不自动归档。
    return idx === flow.length - 1 ? null : flow[idx + 1];
  }
  // 流外脏值 (含 archived): 按 CONTENT_STAGES 全集顺序, 找该平台流内第一个位于其后的阶段。
  const pos = CONTENT_STAGES.indexOf(stage);
  for (let i = pos + 1; i < CONTENT_STAGES.length; i += 1) {
    const candidate = CONTENT_STAGES[i];
    if (isStageInFlow(platform, candidate, deliveryMode)) return candidate;
  }
  return null;
}

export function schedulableStagesFor(platform: string, deliveryMode?: 'manual' | 'ai-faceless'): WorkStage[] {
  const flow = stageFlowFor(platform, deliveryMode);
  return SCHEDULABLE_STAGES.filter((stage) => flow.includes(stage));
}
