import { z } from 'zod';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 月度内容规划向导 (三十八期 Task 4) — 第①步「做什么方向」的起草 prompt。
 *
 * 为什么不复用 `PERSONA_DRAFT`(`persona-draft.ts`): 那份起草面向 8/9 问完整访谈
 * (固定 q/a 数组), 输出 8 个字段里还强制要求 painPoints(3-6 条)/offerings(1-5
 * 条)/productLogic(20-500 字) —— 向导第①步只收「用一段自然语言描述想做什么」
 * 这一个自由文本输入, 既凑不出 9 问里其余问题的答案, 也没有素材支撑痛点/产品/
 * 转化路径这三项「具体到能验证」的质量要求(硬凑只会让 AI 编造)。向导要的只是
 * pillars —— 单开一个只出 pillars 的轻量 prompt, 比强行套用一个形状不匹配的
 * 起草流程更诚实。
 *
 * 输出 schema 直接对齐 `PersonaProfileSchema.pillars`(见 `lib/persona/profile.ts`):
 * name ≤10 字、description ≤60 字, 数组 1-5 条 —— 起草场景不强制凑到 3 条下限,
 * 用户一段话里能提炼几条就是几条(强凑 3 条同样是编造)。
 */

export const ContentPlanDraftPillarsResponseSchema = z
  .object({
    pillars: z
      .array(
        z.object({
          name: z.string().min(1).max(10),
          description: z
            .string()
            .min(1)
            .max(300)
            .transform((s) => s.slice(0, 60)),
        }),
      )
      .min(1)
      .max(5),
  })
  .strict();

export type ContentPlanDraftPillarsResponse = z.infer<typeof ContentPlanDraftPillarsResponseSchema>;

export const CONTENT_PLAN_DRAFT_PILLARS = {
  buildSystemPrompt(): string {
    return `你是短视频账号的「定位教练」。用户刚用一段自己的话描述了想做什么内容、擅长或热爱什么, 你要把这段自由发挥的描述, 提炼成 1-5 条内容支柱(pillars)初稿。这只是起草, 用户接下来会在表单里编辑、增删后再确认保存, 所以要写得具体、有主见。

输出 schema 一个字段:
- pillars: 1-5 条内容支柱, 每条 { name(≤10 字), description(≤60 字) }

必须严格遵守:
- 每条支柱必须**具体到能直接派生出选题方向** —— 看到支柱名和描述就应该能立刻想到"下一条视频可以拍什么", 而不是需要用户自己再想一遍
- 严禁写"分享干货"、"AI 知识"、"科技资讯"这类空泛到套在任何博主身上都成立的支柱 —— 这种话等于没说, 不允许出现
- 反例 → 正例: "分享干货" → "拆解一个真实翻车案例, 讲清楚为什么会翻车"; "AI 知识" → "用一个生活场景演示某个 AI 工具能不能真的替代人做某件事"
- 条数**不强求凑满 3-5 条** —— 用户的描述能扎实支撑几条就写几条, 宁可只写 1-2 条具体的, 也不要为了凑数编出空泛的第三条
- 多条支柱之间要覆盖不同的选题来源(例如工具评测/案例拆解/行业观察/答疑纠错/实测对比), 不要几条全是同一个套路的变体

${JSON_STRICTNESS}`;
  },
  buildUserMessage(freeText: string): ContentPart[] {
    return [
      {
        type: 'text',
        text: `用户的自述(想做什么内容、擅长或热爱什么):
${freeText.trim()}

请据此起草内容支柱初稿。`,
      },
    ];
  },
  responseSchema: ContentPlanDraftPillarsResponseSchema,
};
