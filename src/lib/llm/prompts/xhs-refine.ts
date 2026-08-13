import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';
import type { StyleContext } from './script-write-douyin';
import { buildXhsStyleSection } from './script-write-xhs';
import type { ResearchBrief } from './research-brief';

/**
 * 小红书整稿改稿 — 在已生成的图文笔记基础上二次修改。
 * 只重写 intro + body 两个区块 (titles / coverText / tags / shotIdeas 不变, 不重新生成),
 * 响应 schema 边界与 XHSScriptResponseSchema 的 intro/body 保持一致。
 */

function briefSectionText(brief: ResearchBrief | null): string {
  if (!brief || brief.points.length === 0) return '';
  return `

素材简报 (如与本次改写相关, 请把相关 fact 自然引进 intro 或 body):
${brief.points
    .map((p, i) => `${i + 1}. fact: ${p.fact}\n   source: ${p.source}\n   usage: ${p.usage}`)
    .join('\n')}`;
}

export const XHS_REFINE = {
  buildSystemPrompt(niche: string, style: StyleContext): string {
    return `${getExpertPersona(niche)}

任务: 你收到一份已经写好的小红书图文笔记 (intro + body), 用户想按指令重写这两部分。

改写要求:
- 只重写 intro 和 body 两部分, 其余区块 (titles / coverText / tags / shotIdeas) 保持不变, 不要在返回里输出
- intro 20-150 字, body 150-800 字, 边界与原稿一致
- 小红书语感 —— 情感化、短段落、换行多, 比抖音文案更温; body 关键句用 ** 加粗
- 如果收到了素材简报, 相关 fact 要自然引进 intro 或 body, 不要遗漏
- 严格按用户给出的 instruction 改写, 不要自由发挥偏离要求

${buildXhsStyleSection(style)}

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: {
    intro: string;
    body: string;
    instruction: string;
    brief: ResearchBrief | null;
  }): ContentPart[] {
    return [
      {
        type: 'text',
        text: `当前 intro:
${input.intro}

当前 body:
${input.body}

改写要求: ${input.instruction}${briefSectionText(input.brief)}

按 schema 只输出 intro 和 body。`,
      },
    ];
  },
  responseSchema: z.object({
    intro: z.string().min(20).max(150),
    body: z.string().min(150).max(800),
  }),
};
