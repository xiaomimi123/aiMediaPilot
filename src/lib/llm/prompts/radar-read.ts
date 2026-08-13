import { z } from 'zod';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 热点雷达 — 阅读评分 prompt。
 *
 * 评估视角固定为「AI 知识类抖音创作者」看一篇全网抓取到的文章/资讯，
 * 判断它是否值得改编成下一条选题 (不是通用多 niche 评估，故不走 getExpertPersona)。
 */

export const RadarReadResponseSchema = z.object({
  summary: z.string().min(1).max(120), // 内容摘要, ≤120 字
  angle: z.string().min(1).max(80), // 建议的短视频切入角度, ≤80 字
  relevance: z.number().int().min(0).max(100), // 与关键词/赛道相关度
  freshness: z.number().int().min(0).max(100), // 信息新旧与时效性
  discussion: z.number().int().min(0).max(100), // 可讨论性/争议度/情绪钩子
  feasibility: z.number().int().min(0).max(100), // 改编成短视频的可行性
  suggestedKeywords: z.array(z.string().min(1).max(20)).min(0).max(3), // 建议追加的雷达关键词, 0-3 个
  // 命中的人设内容支柱名 (与 PersonaPillar.name 精确匹配) 或 null (未命中/无人设档案时不产出该字段, 走 default)
  pillarHit: z.string().max(10).nullable().optional().default(null),
});

export type RadarReadResponse = z.infer<typeof RadarReadResponseSchema>;

export interface RadarReadInput {
  title: string;
  content: string;
  sourceSite: string;
  matchedKeywords: string[];
}

const CONTENT_MAX_CHARS = 6000;

export const RADAR_READ = {
  /**
   * personaSection 缺省/空串时, 输出必须与不传参数时字符级一致 (兼容 T4 采集管线未接入人设档案的场景,
   * 以及现有测试断言)。非空时: 拼入人设定位 + relevance 语义句换成「对上述定位的价值」+ 要求判断 pillarHit。
   */
  buildSystemPrompt(personaSection?: string): string {
    const hasPersona = Boolean(personaSection && personaSection.trim());

    const relevanceLine = hasPersona
      ? '- relevance (相关度): 对上述定位的价值 — 越贴近你的定位核心话题分越高, 擦边/无关话题分低'
      : '- relevance (相关度): 与用户关注的关键词 / AI 知识赛道的相关程度 — 越贴近赛道核心话题分越高, 擦边/无关话题分低';

    const personaBlock = hasPersona
      ? `\n\n你的定位:\n${personaSection}\n\n另外判断这篇内容是否命中上述内容支柱之一: 命中则在 pillarHit 字段填写该支柱的准确名称 (须与列出的支柱名完全一致), 未命中则填 null。`
      : '';

    return `你是「AI 知识类抖音创作者」的选题雷达阅读助手。 你的任务: 阅读全网抓取到的一篇文章/资讯, 评估它作为下一条抖音短视频选题的价值。${personaBlock}

评估维度 (均为 0-100 整数):
${relevanceLine}
- freshness (时效性): 信息新旧与时效 — 刚发生的新模型/新功能/新事件分高, 陈旧转述或已被讲烂的老话题分低
- discussion (可讨论性): 是否有争议度、反常识结论、情绪钩子, 能引发评论区讨论/转发/站队
- feasibility (可行性): 改编成短视频的可行性 — 能否在 1-3 分钟内讲清楚, 是否有具体案例/数字/可视化素材, 而不需要长篇背景铺垫才能讲明白

另外产出:
- summary: 这篇内容讲了什么, ≤120 字, 简体中文
- angle: 如果要做成短视频, 建议的切入角度, ≤80 字, 简体中文
- suggestedKeywords: 从文章里提炼出的、值得加入雷达关键词库持续追踪的新词, 0-3 个 (没有合适的就给空数组, 不要硬凑)

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: RadarReadInput): ContentPart[] {
    const content = input.content.trim().slice(0, CONTENT_MAX_CHARS);
    const keywords =
      input.matchedKeywords.length > 0 ? input.matchedKeywords.join('、') : '(无)';
    return [
      {
        type: 'text',
        text: `标题: ${input.title}
来源: ${input.sourceSite}
命中关键词: ${keywords}

正文:
${content || '(无正文, 仅标题)'}

按 schema 输出评估结果。`,
      },
    ];
  },
  responseSchema: RadarReadResponseSchema,
};
