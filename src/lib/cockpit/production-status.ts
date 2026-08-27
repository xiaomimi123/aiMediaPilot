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
