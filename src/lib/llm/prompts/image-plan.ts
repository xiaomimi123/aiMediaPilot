import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 出图计划 — 为已生成的小红书图文笔记规划全套配图 (封面 + shotIdeas 对应图)。
 *
 * idx=0 固定是封面图, idx 1..N 依次对应 XHSScriptResponseSchema.shotIdeas 的次序
 * (vendor 既有约定: shotIdeas 的 idx 从 1 开始)。images 数组长度必须等于
 * 1 (封面) + shotIdeas 条数, 由消费方 (plan 路由) 校验; 这里的 schema 只兜底 ≤10。
 */

export const ImagePlanSchema = z.object({
  style: z.string().min(10).max(300), // 全篇统一视觉风格英文 token
  images: z
    .array(
      z.object({
        idx: z.number().int().min(0).max(9),
        prompt: z.string().min(20).max(800),
      }),
    )
    .min(1)
    .max(10),
});

export type ImagePlan = z.infer<typeof ImagePlanSchema>;

export interface ImagePlanInput {
  coverText: string;
  intro: string;
  body: string;
  shotIdeas: { idx: number; description: string }[];
}

export const IMAGE_PLAN = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 为这篇小红书图文笔记规划全套配图 (封面 + 正文配图), 按 schema 产出:

1. style: 全篇统一的视觉风格描述, 用英文 token 拼接 (例: "minimalist flat illustration, warm pastel color palette, soft shadow, clean vector style"), 后续每张图的 prompt 都要融合这个风格, 保证整套图视觉统一
2. images: 每张图一条完整的英文 AI 绘图 prompt (已经把 style 融合进去, 不需要读者再另外拼接 style), 每条包含 idx (图片序号) + prompt (完整英文描述)
   - idx=0 是封面图: prompt 必须包含把用户给出的中文封面文字作为海报大字渲染的明确要求 (例如 "render the given Chinese headline text as bold poster-style large text overlay"), 文字务必准确清晰, 不能篡改、增删或替换成拼音/近似字
   - idx 1..N 依次对应用户给出的配图建议 (shotIdeas) 的顺序, 每张图的 prompt 要具体还原该条 shotIdea 描述的画面内容, 同时结合 intro/body 的正文语境
   - 全部竖版 3:4 构图 (portrait 3:4 aspect ratio), 适配小红书图文笔记展示比例
   - images 数组长度必须严格等于 1 (封面) + shotIdeas 条数, 不能多也不能少

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: ImagePlanInput): ContentPart[] {
    const shotIdeasText = input.shotIdeas.map((s) => `idx=${s.idx}: ${s.description}`).join('\n');
    const expectedCount = 1 + input.shotIdeas.length;
    return [
      {
        type: 'text',
        text: `封面文字 (coverText): ${input.coverText}

开头 (intro):
${input.intro}

正文 (body):
${input.body}

配图建议 (shotIdeas, 共 ${input.shotIdeas.length} 张, 对应 idx 1..${input.shotIdeas.length}):
${shotIdeasText}

按 schema 输出 style + images (images 数组长度必须 = 1 封面 + ${input.shotIdeas.length} 张配图 = ${expectedCount})。`,
      },
    ];
  },
  responseSchema: ImagePlanSchema,
};
