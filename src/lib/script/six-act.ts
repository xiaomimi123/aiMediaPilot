import { z } from 'zod';

/**
 * 六幕 schema + 时长分配纯函数 (十三期任务一)。
 *
 * 抖音逐字稿结构从「hook/main×N/cta」改为固定六幕
 * (hook/concept_a/concept_b/trivia/synthesis/punchline), 向外部工具 script_spec.md
 * 的六幕格式对齐。本文件是 T2-T6 唯一消费的基础层: 六幕常量、schema、时长分配、
 * 形状判别 —— 后续各消费点(生成 prompt/存储/前端渲染等)都从这里导入, 不再各写各的。
 *
 * `isSixActScript` 是**唯一的形状判别入口**: 六处消费点都用它分岔新旧结构,
 * 避免出现"有的地方判 sections 存在, 有的地方判 acts.length === 6"这类各写各的漂移。
 */

export const ACT_KEYS = ['hook', 'concept_a', 'concept_b', 'trivia', 'synthesis', 'punchline'] as const;

export type ActKey = (typeof ACT_KEYS)[number];

export const ACT_LABELS: Record<ActKey, string> = {
  hook: '开场钩子',
  concept_a: '概念A',
  concept_b: '概念B',
  trivia: '冷知识',
  synthesis: '知识串联',
  punchline: '金句收尾',
};

/** 占比取 script_spec 区间中值并归一化, 合计 = 1。 */
export const ACT_RATIOS: Record<ActKey, number> = {
  hook: 0.1,
  concept_a: 0.225,
  concept_b: 0.225,
  trivia: 0.15,
  synthesis: 0.225,
  punchline: 0.075,
};

export interface ActFact {
  claim: string;
  value: string;
  source: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ActBeat {
  keyword: string;
}

export interface ScriptAct {
  act: ActKey;
  title: string;
  narration: string;
  visual: string;
  note: string;
  targetSec: number;
  beats: ActBeat[];
  facts: ActFact[];
}

export interface FourDims {
  gain: string;
  surprise: string;
  clarity: string;
  appeal: string;
}

const ActBeatSchema = z.object({
  keyword: z.string().min(1),
});

const ActFactSchema = z.object({
  claim: z.string().min(1),
  value: z.string().min(1),
  source: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
});

/** 单幕 schema —— narration/visual/note 宽进严出: 放宽上限接住 AI 超发挥, transform 截到展示上限。 */
const ScriptActSchema = z.object({
  act: z.enum(ACT_KEYS),
  title: z.string().max(20),
  narration: z
    .string()
    .min(10)
    .max(1500)
    .transform((s) => s.slice(0, 800)),
  visual: z
    .string()
    .max(300)
    .transform((s) => s.slice(0, 80)),
  note: z
    .string()
    .max(400)
    .transform((s) => s.slice(0, 120)),
  targetSec: z.number().int().min(1),
  beats: z.array(ActBeatSchema).min(3).max(5),
  facts: z.array(ActFactSchema).min(0).max(8),
});

const FourDimsSchema = z.object({
  gain: z.string().min(1),
  surprise: z.string().min(1),
  clarity: z.string().min(1),
  appeal: z.string().min(1),
});

/**
 * acts 恰好 6 项且 act 值须按 ACT_KEYS 顺序排列 —— superRefine 逐位校验顺序,
 * 不只校验集合(乱序但集合齐全同样拒绝)。
 */
export const SixActScriptSchema: z.ZodType<{ acts: ScriptAct[]; four_dims: FourDims }, z.ZodTypeDef, any> = z.object(
  {
    acts: z
      .array(ScriptActSchema)
      .length(6)
      .superRefine((acts, ctx) => {
        ACT_KEYS.forEach((expected, index) => {
          if (acts[index]?.act !== expected) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `acts[${index}] 应为 "${expected}"`,
              path: [index, 'act'],
            });
          }
        });
      }),
    four_dims: FourDimsSchema,
  },
);

/**
 * 按 ACT_RATIOS 分配并四舍五入; 余数补给 concept_a(占比最大之一), 保证 sum === durationSec。
 */
export function allocateActSeconds(durationSec: number): Record<ActKey, number> {
  const allocation = {} as Record<ActKey, number>;
  let allocated = 0;
  for (const key of ACT_KEYS) {
    const seconds = Math.max(1, Math.round(ACT_RATIOS[key] * durationSec));
    allocation[key] = seconds;
    allocated += seconds;
  }
  allocation.concept_a += durationSec - allocated;
  return allocation;
}

/**
 * 唯一的形状判别入口 —— 六处消费点都用它分岔, 避免各写各的判别逻辑。
 */
export function isSixActScript(script: unknown): script is { acts: ScriptAct[]; four_dims: FourDims } {
  return SixActScriptSchema.safeParse(script).success;
}
