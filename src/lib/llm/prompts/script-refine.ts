import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';
import {
  ScriptSectionSchema,
  buildStyleSection,
  type DouyinScriptSection,
  type StyleContext,
} from './script-write-douyin';
import type { ResearchBrief } from './research-brief';

/**
 * 改稿 — 在已生成的完整逐字稿基础上二次修改。两种模式:
 * - section 模式: 只重写指定 targetIdx 那一块, 其余块必须逐字原样返回
 * - all 模式: 按指令重写全部块, 但保持块数/role/秒段结构不变
 */

function briefSectionText(brief: ResearchBrief | null): string {
  if (!brief || brief.points.length === 0) return '';
  return `

素材简报 (如与本次改写相关, 请把相关 fact 真实引用进正文):
${brief.points
    .map((p, i) => `${i + 1}. fact: ${p.fact}\n   source: ${p.source}\n   usage: ${p.usage}`)
    .join('\n')}`;
}

export const SCRIPT_REFINE = {
  buildSectionSystemPrompt(niche: string, style: StyleContext): string {
    return `${getExpertPersona(niche)}

任务: 你收到一份已经写好的抖音口播逐字稿 (按 sections 分块), 用户只想重写其中一块 (targetIdx 指定), 其余块必须原样返回。

改写要求:
- 只重写 targetIdx 指定的那一块, 其余块的 role / startSec / endSec / text 必须逐字原样返回, 不允许有任何改动 (包括标点和空格)
- 被重写的这一块 role 与 startSec/endSec 保持不变, 只改 text 内容
- 新的 text 依然要是能直接照着念的口语逐字稿, 短句, 拒绝书面语
- 严格按用户给出的 instruction 改写, 不要自由发挥偏离要求

${buildStyleSection(style)}

${JSON_STRICTNESS}`;
  },
  buildAllSystemPrompt(niche: string, style: StyleContext): string {
    return `${getExpertPersona(niche)}

任务: 你收到一份已经写好的抖音口播逐字稿 (按 sections 分块), 按用户给出的 instruction 重写全部内容。

改写要求:
- 保持原有的块数、每块的 role 顺序 (第一块 hook, 最后一块 cta, 中间 main) 以及每块的 startSec/endSec 秒段结构不变, 只重写 text 内容
- 新的 text 依然要是能直接照着念的口语逐字稿, 短句, 拒绝书面语
- 严格按用户给出的 instruction 执行改写, 不要自由发挥偏离要求

${buildStyleSection(style)}

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: {
    sections: DouyinScriptSection[];
    instruction: string;
    targetIdx?: number;
    brief: ResearchBrief | null;
  }): ContentPart[] {
    const sectionsText = input.sections
      .map((s, i) => `[${i}] role=${s.role} ${s.startSec}-${s.endSec}s: ${s.text}`)
      .join('\n');
    const targetSection =
      input.targetIdx !== undefined ? `\n\n本次只重写第 ${input.targetIdx} 块 (从 0 开始计数), 其余块原样返回。` : '';

    return [
      {
        type: 'text',
        text: `当前逐字稿:
${sectionsText}

改写要求: ${input.instruction}${targetSection}${briefSectionText(input.brief)}

按 schema 输出完整 sections。`,
      },
    ];
  },
  responseSchema: z.object({ sections: z.array(ScriptSectionSchema).min(3).max(6) }),
};
