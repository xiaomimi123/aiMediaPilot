// 十三期: 抖音逐字稿六幕改造 —— 内容详情页步骤条状态纯函数。
// 纯模块: 零 IO, 零 React。给定一个平台的阶段 flow (见 platform-stages.ts stageFlowFor)
// 与内容当前 stage, 算出 flow 里每个阶段节点应显示的视觉状态。
import { CONTENT_STAGES } from './model';
import type { ContentStage, WorkStage } from './model';

export type StepStatus = 'done' | 'current' | 'upcoming';

export interface StepNode {
  stage: WorkStage;
  status: StepStatus;
}

export function computeStepNodes(flow: WorkStage[], currentStage: ContentStage): StepNode[] {
  const flowIndex = flow.indexOf(currentStage as WorkStage);
  if (flowIndex !== -1) {
    return flow.map((stage, i) => ({
      stage,
      status: i < flowIndex ? 'done' : i === flowIndex ? 'current' : 'upcoming',
    }));
  }

  // currentStage 不在 flow 中 (archived, 或已脱离该平台流的脏值)。
  // 用 CONTENT_STAGES 全集下标判断: 若 currentStage 排在 flow 首项之前 (如 inbox), 语义上
  // "还没到" —— 全部 upcoming; 否则视为已越过整个 flow (含 archived) —— 全部 done
  // (historical 语义, 与 content-drawer.tsx `historical`/`completed` 计算口径一致)。
  const globalIndex = CONTENT_STAGES.indexOf(currentStage);
  const flowStartGlobalIndex = flow.length > 0 ? CONTENT_STAGES.indexOf(flow[0]) : -1;
  const notYetArrived =
    globalIndex !== -1 && flowStartGlobalIndex !== -1 && globalIndex < flowStartGlobalIndex;

  return flow.map((stage) => ({ stage, status: notYetArrived ? 'upcoming' : 'done' }));
}
