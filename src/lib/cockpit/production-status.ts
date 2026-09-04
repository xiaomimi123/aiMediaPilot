/**
 * 生成任务状态的共享判断(二十二期)。
 *
 * 单独成模块的唯一原因: 「哪些状态可以手动开始制作」同时被 **服务端路由**
 * (start/route.ts 的前置校验)和 **客户端成片页**(要不要渲染按钮)消费。
 * 各写一份必然漂移 —— 服务端放开了一个状态而按钮不出现, 或者按钮出现了点下去
 * 被 400, 两种都是用户看得见的 bug。
 */

/** 还没真正开工(或已失败可重来)的状态。 */
export const STARTABLE_PRODUCTION_STATUS = ['queued', 'source_uploaded', 'failed'] as const;

export function canStartProduction(status: string): boolean {
  return (STARTABLE_PRODUCTION_STATUS as readonly string[]).includes(status);
}

/**
 * 三十一期(生成前剪辑台) Task 1: PATCH 切换渲染器允许的状态清单——比
 * `STARTABLE_PRODUCTION_STATUS` 多放行 `plan_ready`(分镜待确认)。
 *
 * 不复用同一份清单的理由: `plan_ready` 不该出现在 `STARTABLE_PRODUCTION_STATUS`
 * 里——start=重新产 plan 会覆盖用户在剪辑台里对方案做的调整, 必须走 Task 4 的显式
 * 确认对话框, 不能通过 start 直接触发。但切换渲染器本身就要清空 filmPlan/alignedActs
 * (`route.ts` PATCH 处理逻辑), 在 `plan_ready` 这个状态下切换语义天然自洽(plan 反正
 * 清空重来), 所以单独开一条清单, 不与 start 共用。
 */
export const RENDERER_SWITCHABLE_STATUS = [...STARTABLE_PRODUCTION_STATUS, 'plan_ready'] as const;

export function canSwitchRenderer(status: string): boolean {
  return (RENDERER_SWITCHABLE_STATUS as readonly string[]).includes(status);
}
