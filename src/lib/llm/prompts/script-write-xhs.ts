import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';
import { XHSScriptResponseSchema } from './script-generate-xiaohongshu';
import type { StyleContext } from './script-write-douyin';
import type { ResearchBrief } from './research-brief';

/**
 * 小红书两阶段写稿 — 与 script-generate-xiaohongshu.ts (单阶段生成 6 区块) 不同,
 * 这里复用同一份 XHSScriptResponseSchema, 但配合 StyleContext (博主风格) + ResearchBrief (素材简报)
 * 产出更贴合博主本人语感的完整图文笔记。
 */

function briefSectionText(brief: ResearchBrief | null): string {
  if (!brief || brief.points.length === 0) return '';
  return `

素材简报 (请将下列 fact 自然引进 intro 或 body, 具体数字/案例照写, 不要转述得含糊, 也不要遗漏):
${brief.points
    .map((p, i) => `${i + 1}. fact: ${p.fact}\n   source: ${p.source}\n   usage: ${p.usage}`)
    .join('\n')}`;
}

/**
 * 把 StyleContext 渲染成 system prompt 里的一段文字 — 小红书版本。
 * samples 模式下真实嵌入博主本人定稿笔记原文, description 模式下附风格说明段。
 * 写稿 (SCRIPT_WRITE_XHS) 与改稿 (XHS_REFINE) 共用, 保证两处风格还原方式一致。
 */
export function buildXhsStyleSection(style: StyleContext): string {
  if (style.mode === 'samples') {
    const samplesText = style.samples
      .map((sample, i) => `【样本 ${i + 1}】\n${sample}`)
      .join('\n\n');
    return `博主风格参考: 以下是博主本人最近定稿笔记, 模仿其口吻/句式/用词习惯来写这次的稿子 (只学说话方式, 不要照抄样本内容或案例):

${samplesText}`;
  }
  return `博主风格参考: ${style.description}`;
}

export const SCRIPT_WRITE_XHS = {
  /**
   * personaSection 缺省/空串时, 输出必须与不传参数时字符级一致 (现有测试断言)。
   * 非空时: 拼在 getExpertPersona 之后、任务描述之前。
   */
  buildSystemPrompt(
    niche: string,
    style: StyleContext,
    personaSection?: string,
    voiceSection?: string,
  ): string {
    const hasPersona = Boolean(personaSection && personaSection.trim());
    const personaBlock = hasPersona ? `\n\n你的定位:\n${personaSection}` : '';
    // 十二期: 人物志与经历独立成块 —— 与人设定位档案是两份互不依赖的档案,
    // 只建了其中一份时另一份仍须注入 (voiceSection 自带前导换行, 见 buildVoiceSection)。
    const voiceBlock = voiceSection && voiceSection.trim() ? voiceSection : '';
    return `${getExpertPersona(niche)}${personaBlock}${voiceBlock}

任务: 为这条小红书 图文笔记 写一份可以直接发布的完整内容, 按 schema 产出 titles / coverText / intro / body / tags / shotIdeas。

图文笔记写作要求:
- intro (开头钩子, 20-150 字): 第 1-2 句话引发共鸣或承诺收益, 多用 "你是不是也..." / "上周我..." 这种贴近读者的句式
- body (正文, 150-800 字): 小红书语感 —— 情感化、短段落、换行多, 比抖音文案更温; 分点列举或讲故事; 关键句用 ** 加粗
- 如果收到了素材简报, 简报里每条 fact 都要自然引进 intro 或 body 对应段落 (具体数字/案例照写, 不要转述得含糊, 也不要遗漏)
- titles 保留含 emoji 的惯例 (例: "✨打工人秒变效率怪 | 这个 prompt 我藏不住了")
- coverText / tags / shotIdeas 按 schema 要求产出
- suggestedIntent: 根据这条内容本身的性质, 判断最适合的结尾 CTA 意图 —— reach (引流互动) / trust (建立信任) / convert (转化), 没有明显倾向则填 null

${buildXhsStyleSection(style)}

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: { topic: string; brief: ResearchBrief | null }): ContentPart[] {
    return [
      {
        type: 'text',
        text: `主题: ${input.topic}${briefSectionText(input.brief)}

按 schema 输出完整图文笔记。`,
      },
    ];
  },
  responseSchema: XHSScriptResponseSchema,
};
