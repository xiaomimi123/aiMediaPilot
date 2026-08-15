import { z } from 'zod';
import { JSON_STRICTNESS } from './base';
import { getExpertPersona } from './expert-persona';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 经历打标签 (十二期 T3) —— 用户「随手记一笔」后自动归类, 用户不需要自己分类。
 *
 * 关键约束: 这个 prompt **只产出元数据** (主题/类型/检索关键词), 绝不改写原文 ——
 * 用户随手记的原话是经历库的价值本身 (写稿时要原样引用他的真实表达), 润色即失真。
 * 原文的保存由路由负责, prompt 拿不到写回原文的机会。
 *
 * keywords 直接决定 matchExperiences 的召回质量, 所以要求"写稿时可能用到的检索词"
 * 而不是摘要词。
 */
export const ExperienceTagSchema = z.object({
  topic: z.string().min(1).max(20),
  kind: z.enum(['practice', 'failure', 'insight', 'result']),
  keywords: z.array(z.string().min(1).max(12)).min(3).max(5),
});

export type ExperienceTagResponse = z.infer<typeof ExperienceTagSchema>;

export const EXPERIENCE_TAG = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 用户随手记了一条自己的真实经历, 你为它生成检索元数据。**不要改写、不要润色原文**,
只输出下面三个字段。

**topic (主题标签, 1-20 字)**
这条经历讲的是什么, 用创作者选题时会用的说法 (例: "AI 写作工具"/"副业接单"/"效率工作流")。

**kind (类型, 四选一)**
- practice: 实践 —— 做了某件事、用了某个工具的过程
- failure: 翻车 —— 出错、走弯路、试了没成
- insight: 认知刷新 —— 想法被改变、意识到某件事
- result: 成果 —— 拿到了某个结果、数据、收入

**keywords (检索关键词, 3-5 个, 每个 ≤12 字)**
这些词决定了将来写某个选题时能不能검索到这条经历, 所以要写**别人搜这个话题时会用的词**,
不是原文摘要。
- 覆盖: 涉及的工具名 / 场景 / 动作 / 结果
- 好例 (原文"用 Claude 写小红书文案连续翻车三次, 最后发现是没给它看过往爆款"):
  ["Claude", "小红书文案", "翻车", "参考样本"]
- 坏例: ["经历", "感受", "分享"] —— 这种词谁都能匹配上, 等于没有检索价值

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: { content: string }): ContentPart[] {
    return [{ type: 'text', text: `经历原文:\n${input.content}\n\n按 schema 输出元数据。` }];
  },
  responseSchema: ExperienceTagSchema,
};
