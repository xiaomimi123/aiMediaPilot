import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import { formatStyleHints, type InspirationStyleHints } from './style-hints';
import type { ContentPart } from '@/lib/llm/vision';

export const DouyinScriptResponseSchema = z.object({
  hooks: z.array(
    z.object({
      text: z.string().min(5).max(100),
      rationale: z.string().min(5).max(200),
    })
  ).length(3),
  retentionBeats: z.array(
    z.object({
      startSec: z.number().int().nonnegative(),
      endSec: z.number().int().positive(),
      beat: z.string().min(3).max(200),
    })
  ).min(3).max(10),
  titles: z.array(
    z.object({
      text: z.string().min(5).max(60),
      hookType: z.string().min(2).max(30),
    })
  ).length(3),
  cover: z.object({
    textOverlay: z.string().min(2).max(20),
    shotIdea: z.string().min(5).max(200),
    colorTone: z.string().min(2).max(50),
  }),
});

export type DouyinScriptResponse = z.infer<typeof DouyinScriptResponseSchema>;

export const SCRIPT_GENERATE_DOUYIN = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 用户给你一个视频主题 (topic), 你为这个待拍 抖音短视频 生成 4 个区块:

1. hooks (3 个候选钩子, 0:00-0:03 开头用)
   - text: 实际口播文案 / 屏幕字幕, ≤ 30 字
   - rationale: 一句话说明为什么这个钩子能抓住 0-3s 注意力 (痛点/反差/数字/悬念 哪类)

2. retentionBeats (节奏拆段, 假设视频 30-60s 长)
   - 每段一行: startSec / endSec / beat (这段做什么)
   - 段数 3-10, 推荐 5-7 段
   - beat 要具体, 不要 "进入内容" 这种空话

3. titles (3 个候选标题, ≤ 25 字)
   - text: 标题
   - hookType: 钩子类型 (数字/反差/问题/承诺/悬念)

4. cover (单个封面方案)
   - textOverlay: 封面上的文字 (≤ 8 字)
   - shotIdea: 一句话描述镜头内容
   - colorTone: 配色基调 (例 "白底红字 / 深色高对比")

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: { topic: string; styleHints?: InspirationStyleHints }): ContentPart[] {
    return [
      {
        type: 'text',
        text: `主题: ${input.topic}${formatStyleHints(input.styleHints)}\n\n按 schema 输出 4 个区块。`,
      },
    ];
  },
  responseSchema: DouyinScriptResponseSchema,
};

// Legacy aliases for backwards compat — consumers will migrate over time
export const ScriptGenerateResponseSchema = DouyinScriptResponseSchema;
export type ScriptGenerateResponse = DouyinScriptResponse;
export const SCRIPT_GENERATE = SCRIPT_GENERATE_DOUYIN;
