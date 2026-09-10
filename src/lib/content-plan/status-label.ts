/**
 * 三十八期 Task 5: 今日卡 / 列表要渲什么 —— 纯函数, 与组件解耦以便单测钉住。
 *
 * `planDayStatusLabel` 只是文案映射; `nextAction` 才是真正决定「今日卡该渲哪组
 * 按钮」的判别值 —— 组件读它的返回值做 switch, 不在组件里重复一遍状态判断。
 */

export type ContentPlanDayStatus = 'pending' | 'scripted' | 'produced';

const LABELS: Record<ContentPlanDayStatus, string> = {
  pending: '待写',
  scripted: '脚本已好',
  produced: '已出片',
};

export function planDayStatusLabel(status: ContentPlanDayStatus): string {
  return LABELS[status];
}

export type NextAction =
  | { kind: 'generate-script' }
  | { kind: 'produce'; scriptDraftId: string }
  | { kind: 'done'; videoProductionId: string };

/**
 * `scriptDraftId`/`videoProductionId` 由调用方按 status 传对应的一个 —— 这里不重
 * 校验它们是否真的存在(那是 API 层已经保证的不变量), 只做状态→动作的判别。
 */
export function nextAction(
  status: ContentPlanDayStatus,
  ids: { scriptDraftId?: string | null; videoProductionId?: string | null },
): NextAction {
  if (status === 'produced') {
    return { kind: 'done', videoProductionId: ids.videoProductionId ?? '' };
  }
  if (status === 'scripted') {
    return { kind: 'produce', scriptDraftId: ids.scriptDraftId ?? '' };
  }
  return { kind: 'generate-script' };
}
