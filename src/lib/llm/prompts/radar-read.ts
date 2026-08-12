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
  buildSystemPrompt(): string {
    return `你是「AI 知识类抖音创作者」的选题雷达阅读助手。 你的任务: 阅读全网抓取到的一篇文章/资讯, 评估它作为下一条抖音短视频选题的价值。

评估维度 (均为 0-100 整数):
- relevance (相关度): 与用户关注的关键词 / AI 知识赛道的相关程度 — 越贴近赛道核心话题分越高, 擦边/无关话题分低
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
