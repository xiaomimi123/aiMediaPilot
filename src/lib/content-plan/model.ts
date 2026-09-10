import { z } from 'zod';

/**
 * 三十八期: 月度内容规划的类型 + LLM 响应校验。
 *
 * `days` 严格 `.length(30)` —— 不接受部分成功: LLM 只给出 29 条也算失败, 整次
 * 重来, 绝不落一份缺天数的规划(缺哪天由谁补、怎么补是产品决策, 不该由代码兜底)。
 *
 * pillarName 用 `contentPlanGenerateSchema(pillarNames)` 工厂动态构造 enum ——
 * 把生成时刻的人设快照支柱名加固进 schema, 防止模型编出快照之外、听起来像但不存在
 * 的支柱名(同 validatePillarHit 的精确匹配先例)。
 *
 * Task 2/3: 单天换选题(reroll)复用同一份单条形状 —— `contentPlanDayItemSchema`
 * 单独导出, `contentPlanGenerateSchema` 内部改为组装它, 一份字段定义两处消费,
 * 不再各写一遍(限长/类型稍有出入就会两边失配)。
 */

export interface ContentPlanDayItem {
  dayIndex: number;
  pillarName: string;
  topic: string;
  angle: string;
  hookDirection: string;
}

export interface ContentPlanGenerateResponse {
  days: ContentPlanDayItem[];
}

/** 生成时刻的人设快照 —— 只留 prompt 会用到的四个字段, 档案事后改动不影响已生成的规划回溯。 */
export interface PersonaSnapshot {
  audience: string;
  pillars: { name: string; description: string }[];
  angle: string;
  avoid: string;
}

export function contentPlanDayItemSchema(pillarNames: string[]) {
  return z
    .object({
      dayIndex: z.number().int().min(1).max(30),
      // ''(未挂支柱) 始终允许, 快照支柱名之外的一律拒绝。
      pillarName: z.enum(['', ...pillarNames] as unknown as [string, ...string[]]),
      topic: z.string().min(3).max(60),
      angle: z.string().min(3).max(120),
      hookDirection: z.string().min(3).max(120),
    })
    .strict();
}

export function contentPlanGenerateSchema(pillarNames: string[]) {
  return z
    .object({
      days: z.array(contentPlanDayItemSchema(pillarNames)).length(30),
    })
    .strict();
}
