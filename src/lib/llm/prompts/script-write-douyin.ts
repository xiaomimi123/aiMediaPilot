import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';
import type { ResearchBrief } from './research-brief';

/**
 * 抖音口播完整逐字稿生成 — 与 script-generate-douyin.ts (钩子/节奏拆段/标题/封面 4 区块骨架)
 * 不同, 这里直接产出可以照着念的完整逐字稿, 分块覆盖整条视频的秒段。
 */

export const ScriptSectionSchema = z.object({
  role: z.enum(['hook', 'main', 'cta']),
  startSec: z.number().int().nonnegative(),
  endSec: z.number().int().positive(),
  text: z.string().min(10).max(500),
});

export const DouyinFullScriptSchema = z.object({
  sections: z.array(ScriptSectionSchema).min(3).max(6),
  hooks: z
    .array(
      z.object({
        text: z.string().min(5).max(100),
        rationale: z.string().min(5).max(200),
      })
    )
    .length(3),
  titles: z
    .array(
      z.object({
        text: z.string().min(5).max(60),
        hookType: z.string().min(2).max(30),
      })
    )
    .length(3),
  cover: z.object({
    textOverlay: z.string().min(2).max(20),
    shotIdea: z.string().min(5).max(200),
    colorTone: z.string().min(2).max(50),
  }),
});

export type DouyinFullScript = z.infer<typeof DouyinFullScriptSchema>;

/**
 * 写稿 / 改稿共用的风格上下文 — 唯一定义处。
 * research-brief.ts 不需要它; script-refine.ts 从这里 import。
 *
 * mode='description': description 是一段博主风格的文字描述 (语速/口头禅/句式偏好等)
 * mode='samples': samples 是博主本人最近定稿的逐字稿原文, 直接嵌入 prompt 供模仿
 */
export interface StyleContext {
  mode: 'description' | 'samples';
  description: string;
  samples: string[];
}

/**
 * 把 StyleContext 渲染成 system prompt 里的一段文字。
 * samples 模式下真实嵌入样本原文 (不是转述), description 模式下附风格说明段。
 * 写稿 (SCRIPT_WRITE_DOUYIN) 与改稿 (SCRIPT_REFINE) 共用, 保证两处风格还原方式一致。
 */
export function buildStyleSection(style: StyleContext): string {
  if (style.mode === 'samples') {
    const samplesText = style.samples
      .map((sample, i) => `【样本 ${i + 1}】\n${sample}`)
      .join('\n\n');
    return `博主风格参考: 以下是博主本人最近定稿的口播逐字稿样本, 模仿其口吻/句式/用词习惯来写这次的稿子 (只学说话方式, 不要照抄样本内容或案例):

${samplesText}`;
  }
  return `博主风格参考: ${style.description}`;
}

const DURATION_TOLERANCE_RATIO = 0.1;

export const SCRIPT_WRITE_DOUYIN = {
  /**
   * personaSection 缺省/空串时, 输出必须与不传参数时字符级一致 (现有测试断言)。
   * 非空时: 拼在 getExpertPersona 之后、任务描述之前。
   */
  buildSystemPrompt(niche: string, style: StyleContext, personaSection?: string): string {
    const hasPersona = Boolean(personaSection && personaSection.trim());
    const personaBlock = hasPersona ? `\n\n你的定位:\n${personaSection}` : '';
    return `${getExpertPersona(niche)}${personaBlock}

任务: 为这条抖音口播短视频写一份可以直接照着念的口播逐字稿, 按 sections 分块产出。

逐字稿写作要求:
- 每一块 text 必须是能直接开口念出来的口语逐字稿, 用短句, 拒绝书面语/长定语从句/"然而""综上所述""值得注意的是"这类书面转折词
- sections 数量 3-6 块, 第一块 (首块) role 必须是 'hook' (0-3 秒内抓住注意力), 最后一块 (末块) role 必须是 'cta' (引导评论/关注/转发), 中间用若干 role='main' 内容块推进
- 各块的 startSec/endSec 必须首尾相接、从 0 秒开始连续覆盖整条视频, 不留空档也不重叠, 总跨度允许在目标时长的 ±10% 范围内浮动
- 如果收到了素材简报, 简报里每条 fact 都要真实引用进对应正文段落 (具体数字/案例照写, 不要转述得含糊, 也不要遗漏)

${buildStyleSection(style)}

同时产出:
- hooks: 3 个候选开场钩子, 风格与 sections[0] 一致, 供编辑挑选备用
- titles: 3 个候选标题, ≤ 25 字
- cover: 封面方案 (文字 / 镜头 / 配色)

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: {
    topic: string;
    durationSec: 30 | 45 | 60;
    brief: ResearchBrief | null;
  }): ContentPart[] {
    const tolerance = Math.round(input.durationSec * DURATION_TOLERANCE_RATIO);
    const lower = input.durationSec - tolerance;
    const upper = input.durationSec + tolerance;
    const briefSection =
      input.brief && input.brief.points.length > 0
        ? `

素材简报 (请将下列每条 fact 真实引用进正文对应段落, 不要遗漏):
${input.brief.points
            .map((p, i) => `${i + 1}. fact: ${p.fact}\n   source: ${p.source}\n   usage: ${p.usage}`)
            .join('\n')}`
        : '';

    return [
      {
        type: 'text',
        text: `主题: ${input.topic}
视频时长: ${input.durationSec} 秒 (秒段总跨度应落在 ${lower}~${upper} 秒之间, 从 0 秒开始连续覆盖, 不留空档不重叠)${briefSection}

按 schema 输出完整逐字稿。`,
      },
    ];
  },
  responseSchema: DouyinFullScriptSchema,
};
