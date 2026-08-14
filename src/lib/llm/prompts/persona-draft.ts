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
 * 十期 T1: PersonaProfileSchema 扩展了 painPoints/offerings/productLogic/marketInsight/
 * systemSummary 五个字段 (账号定位体系), 但当时起草 prompt (系统提示词里明确写死"输出
 * schema 五个字段") 不涉及它们 —— 先整体 omit 掉再 extend, 避免 LLM 输出必须凭空多出这
 * 五个字段才能通过校验。
 *
 * 十期 T3 (本次): 9 问访谈把 painPoints/offerings/productLogic 三项也纳入起草范围 (访谈
 * 第④⑤⑧问直接对应这三项), 所以重新 extend 回来, 且收紧下限 (起草场景要"给够", 不像
 * PersonaProfileSchema 保存态那样允许留空)。marketInsight (赛道调研, 需要联网/额外调用)
 * 与 systemSummary (对全部字段的归纳, 依赖前面字段先写完) 两项不是访谈能直接问出来的,
 * 继续 omit, 起草在后续任务里单独收口。
 *
 * 十期 T6 修复轮 1: 说明性字段 (pillars[].description / painPoints[].evidence /
 * offerings[].description) 从严格 `.max(N)` 改为「宽收 + transform 截断到 N」——
 * DeepSeek 偶尔在这几个字段上多写几个字就超过原 60/60/80 上限, 导致
 * `callStructured` 的 `responseSchema.parse()` 直接抛错、整条起草请求 500 (走查中
 * 真实复现过一次)。改成宽进严出 (同 `validatePillarHit`/`validatePainHit`/
 * `validateIntent` 一贯纪律): 校验时放宽到 300 字接住 AI 的超发挥, `transform` 里
 * 截到原展示上限, 落库/回填表单的值仍然严格不超限。**主键性字段不放宽**——
 * `pain`(≤30)/`offering.name`(≤20)/`pillar.name`(≤10) 继续严格 `.max()` 拒绝：
 * 这几个字段本身就该简短, 超限说明 AI 理解偏了, 该拒绝而不是截断掩盖。
 * `productLogic` 是唯一一段长文字段, min20/max500 维持不变 (500 字本身已经很宽松,
 * 未观察到真实超限)。
 */
export const PersonaDraftResponseSchema = PersonaProfileSchema.omit({
  marketInsight: true,
  systemSummary: true,
}).extend({
  pillars: z
    .array(
      z.object({
        name: z.string().min(1).max(10),
        description: z
          .string()
          .min(1)
          .max(300)
          .transform((s) => s.slice(0, 60)),
      }),
    )
    .min(3)
    .max(5),
  painPoints: z
    .array(
      z.object({
        pain: z.string().min(1).max(30),
        evidence: z
          .string()
          .max(300)
          .transform((s) => s.slice(0, 60)),
      }),
    )
    .min(3)
    .max(6),
  offerings: z
    .array(
      z.object({
        name: z.string().min(1).max(20),
        type: z.enum(['tool', 'service', 'course']),
        description: z
          .string()
          .max(300)
          .transform((s) => s.slice(0, 80)),
        targetPain: z.string().max(30),
      }),
    )
    .min(1)
    .max(5),
  productLogic: z.string().min(20).max(500),
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

输出 schema 八个字段:
- audience: 目标受众画像 (谁在看), ≤300 字
- targetFans: 想吸引的粉丝/流量画像 (想让谁多看/关注), ≤300 字
- pillars: 3-5 条内容支柱, 每条 { name(≤10 字), description(≤60 字) }
- angle: 差异化角度 (为什么该看你而不是别人), ≤300 字
- avoid: 明确不做什么, ≤300 字
- painPoints: 3-6 条目标人群的具体痛点, 每条 { pain(≤30 字), evidence(≤60 字) }
- offerings: 1-5 条打算靠什么变现/具体卖什么, 每条 { name(≤20 字), type(tool/service/course 三选一), description(≤80 字), targetPain(≤30 字) }
- productLogic: 20-500 字, 观众从刷到你到付费中间要经历的转化路径

内容支柱 (pillars) 是本次起草的核心之一, 也是最容易写空的地方, 必须严格遵守:
- 每条支柱必须**具体到能直接派生出选题方向** —— 看到支柱名和描述就应该能立刻想到"下一条视频可以拍什么", 而不是需要用户自己再想一遍
- 严禁写"分享干货"、"AI 知识"、"科技资讯"这类空泛到套在任何博主身上都成立的支柱 —— 这种话等于没说, 不允许出现
- 反例 → 正例: "分享干货" → "拆解一个真实翻车案例, 讲清楚为什么会翻车"; "AI 知识" → "用一个生活场景演示某个 AI 工具能不能真的替代人做某件事"
- 5 条支柱之间要覆盖不同的选题来源(例如工具评测/案例拆解/行业观察/答疑纠错/实测对比), 不要 3-5 条全是同一个套路的变体
- 用户访谈里没答的问题 (空答案) 不要编造具体事实, 但也不能因此让支柱变得空泛 —— 结合已有的风格说明/样本/关键词做出合理但不武断的推断

痛点 (painPoints) 是本次新增的另一个重灾区, 必须**具体可验证**, 严格遵守:
- 每条痛点必须**具体到能被验证或反驳** —— 看完应该能追问"这个痛点是真的假的、拿什么证明", 而不是一句放之四海皆准的心理感受
- 严禁写"想变得更好"、"想学习新知识"、"想提升自己"这类空泛到套在任何人身上都成立的痛点 —— 这种话等于没说, 不允许出现
- 反例 → 正例: "想变得更好" → "手上装了好几个 AI 工具, 但每次用都要现查怎么用, 效率根本没提上去"; "想学习新知识" → "刷了很多 AI 资讯却拼不成一个能落地的判断, 真要做决策时还是靠猜"
- evidence 要写清这个痛点是从访谈原话/历史样本/雷达关键词里的哪个线索推出来的, 不能是凭空编造的断言

产品供给 (offerings) 对应访谈第⑤问「打算靠什么变现、具体卖什么」, 必须遵守:
- 每一条 offering 的 targetPain 必须**能在 painPoints 里找到对应的那一条**(内容对得上, 不要求逐字相同) —— 不允许列一个不解决任何已写痛点的产品
- description 要写清这个产品/服务具体做什么、怎么解决 targetPain 里那个痛点, 不要只写产品名换个说法

转化路径 (productLogic) 对应访谈第⑧问「观众从刷到你到付费中间要经历什么」, 必须写清楚「刷到 → 关注 → 信任 → 付费」这四段路径, 而不是一句定位口号:
- 刷到: 观众第一次划到你的内容时, 是什么让他停下来没有划走
- 关注: 他为什么会点关注, 而不是看完这一条就走
- 信任: 持续看了几条之后, 是什么让他觉得这个人说的话可信、值得听
- 付费: 信任建立之后, 是什么临门一脚让他愿意真金白银为 offerings 里的产品付钱
- 反例 → 正例: "用专业内容打动用户, 最终转化付费" (只是一句口号, 没有写清楚每个阶段发生了什么) → "刷到一条实测翻车视频觉得敢说真话 → 关注是为了不错过后续实测系列 → 连续看到几次预测和实际结果一致后觉得判断可信 → 遇到自己纠结的工具选型问题时, 直接购买咨询服务省下试错时间"

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
