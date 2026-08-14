import { z } from 'zod';
import { JSON_STRICTNESS } from './base';
import { PersonaProfileSchema } from '@/lib/persona/profile';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 人设定位驱动选题 (八期) — AI 访谈式建档的起草 prompt。
 *
 * 直接 extend T1 的 PersonaProfileSchema (audience/targetFans/angle/avoid 上限沿用),
 * 只收紧 pillars: 起草场景要求给够 3-5 条 (PersonaProfileSchema 本身只约束 ≤5, 允许
 * 保存时留空/单条; 起草是"帮用户从 0 想清楚", 给太少等于没帮上忙), 且 description
 * 不允许空串 (起草不像保存那样容许半填状态)。
 *
 * 十期: PersonaProfileSchema 扩展了 painPoints/offerings/productLogic/marketInsight/
 * systemSummary 五个字段 (账号定位体系), 但本起草 prompt (系统提示词里明确写死"输出
 * schema 五个字段") 不涉及它们 —— 先 omit 掉再 extend, 避免 LLM 输出必须凭空多出这五个
 * 字段才能通过校验 (那五个字段的起草在后续任务里单独收口)。
 */
export const PersonaDraftResponseSchema = PersonaProfileSchema.omit({
  painPoints: true,
  offerings: true,
  productLogic: true,
  marketInsight: true,
  systemSummary: true,
}).extend({
  pillars: z
    .array(
      z.object({
        name: z.string().min(1).max(10),
        description: z.string().min(1).max(60),
      }),
    )
    .min(3)
    .max(5),
});

export type PersonaDraftResponse = z.infer<typeof PersonaDraftResponseSchema>;

export interface PersonaDraftAnswer {
  q: string;
  a: string; // 可空串 — 用户跳过某问
}

export interface PersonaDraftInput {
  answers: PersonaDraftAnswer[];
  styleDescription: string; // StyleProfile.description, 可能是 ''
  sampleExcerpts: string[]; // 最近定稿样本节选 (已由调用方截断)
  radarKeywords: string[]; // 活跃雷达关键词
}

export const PERSONA_DRAFT = {
  buildSystemPrompt(niche: string): string {
    return `你是 ${niche} 赛道创作者的「定位教练」。 用户刚做完一轮建档访谈, 你要基于他的访谈问答, 结合他已有的创作痕迹(说话风格/历史定稿样本/最近在追的热点关键词), 帮他起草一份人设定位档案初稿。 这只是初稿, 用户会在此基础上修改后再确认保存, 所以你要写得具体、有主见, 而不是四平八稳的空话。

输出 schema 五个字段:
- audience: 目标受众画像 (谁在看), ≤300 字
- targetFans: 想吸引的粉丝/流量画像 (想让谁多看/关注), ≤300 字
- pillars: 3-5 条内容支柱, 每条 { name(≤10 字), description(≤60 字) }
- angle: 差异化角度 (为什么该看你而不是别人), ≤300 字
- avoid: 明确不做什么, ≤300 字

内容支柱 (pillars) 是本次起草的核心, 也是最容易写空的地方, 必须严格遵守:
- 每条支柱必须**具体到能直接派生出选题方向** —— 看到支柱名和描述就应该能立刻想到"下一条视频可以拍什么", 而不是需要用户自己再想一遍
- 严禁写"分享干货"、"AI 知识"、"科技资讯"这类空泛到套在任何博主身上都成立的支柱 —— 这种话等于没说, 不允许出现
- 反例 → 正例: "分享干货" → "拆解一个真实翻车案例, 讲清楚为什么会翻车"; "AI 知识" → "用一个生活场景演示某个 AI 工具能不能真的替代人做某件事"
- 5 条支柱之间要覆盖不同的选题来源(例如工具评测/案例拆解/行业观察/答疑纠错/实测对比), 不要 3-5 条全是同一个套路的变体
- 用户访谈里没答的问题 (空答案) 不要编造具体事实, 但也不能因此让支柱变得空泛 —— 结合已有的风格说明/样本/关键词做出合理但不武断的推断

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: PersonaDraftInput): ContentPart[] {
    const answersText = input.answers
      .map((item, i) => `${i + 1}. ${item.q}\n答: ${item.a.trim() || '(用户跳过未答)'}`)
      .join('\n');

    const styleText = input.styleDescription.trim() || '(暂无风格说明)';

    const samplesText =
      input.sampleExcerpts.length > 0
        ? input.sampleExcerpts.map((s, i) => `[样本${i + 1}] ${s}`).join('\n')
        : '(暂无历史定稿样本)';

    const keywordsText =
      input.radarKeywords.length > 0 ? input.radarKeywords.join('、') : '(暂无关注中的热点关键词)';

    return [
      {
        type: 'text',
        text: `访谈问答:
${answersText}

已有说话风格说明:
${styleText}

最近定稿样本节选:
${samplesText}

正在关注的热点关键词:
${keywordsText}

请综合以上信息, 按 schema 起草一份人设定位档案初稿。`,
      },
    ];
  },
  responseSchema: PersonaDraftResponseSchema,
};
