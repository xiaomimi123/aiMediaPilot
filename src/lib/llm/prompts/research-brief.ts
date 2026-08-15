import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 素材简报 — 把「搜索结果正文 + 热点雷达摘要 + 用户自备素材」拼接成的原始文本,
 * 提炼成 3-6 条可以直接写进逐字稿的素材要点。
 *
 * 拼接与截断 (≤ 8000 字) 由调用方 (write worker) 负责, 这里只管提炼。
 */

export const ResearchBriefSchema = z.object({
  points: z
    .array(
      z.object({
        fact: z.string().min(5).max(200), // 具体事实点, 必须有数字/案例/事件等实锤细节
        source: z.string().min(1).max(300), // 来源 URL / '用户素材' / '我的亲身经历'(十二期)
        usage: z.string().min(2).max(100), // 这条素材在稿子里怎么用, 一句话
      })
    )
    .min(1)
    .max(6),
});

export type ResearchBrief = z.infer<typeof ResearchBriefSchema>;

export const RESEARCH_BRIEF = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 你收到一批与这条选题相关的原始素材 (搜索结果正文 + 热点雷达摘要 + 用户自备素材拼接而成的文本), 请从中提炼 3-6 条对这条抖音口播视频有用的素材要点。

每条要点包含 3 个字段:
- fact: 具体的事实点, 必须包含数字/案例/事件等实锤细节, 拒绝"很多人认为""据说""近年来"这类泛泛而谈、没有信息量的表述
- source: 这条素材的来源, 填具体来源 URL; 用户自己上传的资料填 "用户素材"; **标注为「我的亲身经历」
  的素材填 "我的亲身经历"**
- **「我的亲身经历」这类素材优先保留**: 它是创作者本人做过的事, 比任何外部资料都更有说服力,
  也是这条内容区别于同题材内容的唯一来源。只要它与主题沾边就必须出一条要点, 不要因为外部
  资料看起来"更有数据感"就把它挤掉
- usage: 一句话说明这条素材在稿子里怎么用 (e.g. "作为 hook 部分的反差数据" / "main 部分举例佐证" / "用来反驳一个常见误区")

筛选标准: 只挑对这条视频真正有用、能提升说服力或信息密度的素材点, 原始素材里的废话、重复内容、与选题无关的段落直接丢弃, 不要为了凑够数量硬造。

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: { topic: string; rawMaterials: string }): ContentPart[] {
    return [
      {
        type: 'text',
        text: `选题: ${input.topic}

原始素材:
${input.rawMaterials}

按 schema 提炼 3-6 条素材要点。`,
      },
    ];
  },
  responseSchema: ResearchBriefSchema,
};
