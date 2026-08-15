import { z } from 'zod';
import { JSON_STRICTNESS } from './base';
import { getExpertPersona } from './expert-persona';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 人物志 (十二期) — 6 问访谈式建档的起草 prompt。
 *
 * 与八/十期的 PERSONA_DRAFT 分工: 那个起草的是「你做什么生意」(受众/支柱/痛点/商品/
 * 产品逻辑), 这个起草的是「你是谁」(来路/身份/我不是什么/立场/情绪基调)。
 *
 * **不含任何语言风格字段** —— 口吻/句式/口头禅归 StyleProfile, 十二期设计明确切分。
 *
 * 说明性长文字段 (origin) 沿用十期 T6 的宽进严出纪律: 校验放宽接住 AI 超发挥, transform
 * 截到展示上限, 避免多写几个字就整条 500。identity/notIdentity/claim 是主键性短字段,
 * 继续严格拒绝 —— 超限说明 AI 理解偏了 (把一句话身份写成一段话), 该拒不该截。
 */
export const VoiceDraftResponseSchema = z.object({
  origin: z
    .string()
    .min(20)
    .max(1200)
    .transform((s) => s.slice(0, 500)),
  identity: z.string().min(5).max(200),
  notIdentity: z.string().min(5).max(200),
  stances: z
    .array(
      z.object({
        claim: z.string().min(1).max(50),
        reason: z
          .string()
          .min(1)
          .max(300)
          .transform((s) => s.slice(0, 100)),
      }),
    )
    .min(1)
    .max(5),
  energy: z.string().min(2).max(200),
  /** 从第④⑥问的回答里提取的经历候选原文 —— 供前端确认后逐条入经历库 */
  experienceCandidates: z.array(z.string().min(10).max(500)).max(5),
});

export type VoiceDraftResponse = z.infer<typeof VoiceDraftResponseSchema>;

export const VOICE_DRAFT = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 你在帮一位创作者建立「人物志」——回答"你是谁"这个问题, 不是"你做什么生意"。
用户会给你 6 个访谈问题的回答, 你据此起草人物志的五个字段 + 提取经历候选。

**identity (具体身份, 5-200 字)**
必须写成一个**具体的人**, 不是品类标签。品类标签可替换, 具体的人不可替换。
- 坏例: "AI 知识博主" / "效率专家" —— 这是分类, 不是人, 换谁都能用
- 好例: "一个靠 AI 提高认知的普通人, 边学边把踩过的坑讲出来"
如果用户回答里已经有具体的自我描述, 优先原样吸收, 不要替他升级成更"专业"的说法。

**notIdentity (我不是什么, 5-200 字)** —— 这一条最容易被写错, 注意:
必须**原样保留用户的自我否定**, 不许美化成优点。
- 用户说"我不是资深技术极客, 也不是专业程序员" → 就写这个意思
- 禁止改写成"擅长把复杂技术讲得通俗易懂"这类把否定翻译成卖点的表述
这个字段的作用是**护栏**: 后续 AI 写稿时靠它避免把用户包装成他不是的专家。翻译成
优点就等于拆了护栏。

**stances (立场主张, 1-5 条)**
每条 {claim: 你认为什么, reason: 为什么}。要求具体到**可能得罪一部分人**。
- 坏例: "我认为要理性看待 AI" / "我认为 AI 是工具" —— 没有立场, 谁都同意, 等于没说
- 好例: "我认为提示词工程是个伪需求" / "大部分人学 AI 的顺序是反的"
如果用户第④问答得含糊, 从他的其他回答里推断他真实的倾向, 但不要凭空发明立场。

**origin (来路故事, 20-500 字)**
他为什么走上这条路、哪件事让他决定开始做。写成能在视频里讲出来的故事, 不是简历。

**energy (情绪基调, 2-200 字)**
他给人的感觉 (如"自信、有感染力"/"冷静克制"/"自嘲式幽默")。这决定写稿时的表达能量,
不是语言技巧 (那归风格档案)。

**experienceCandidates (经历候选, 0-5 条)**
从用户回答 (尤其第④⑥问) 里提取出的**具体经历原文**, 每条 10-500 字: 他真实做过的事、
用过什么工具、什么时候认知被刷新。要求:
- 只提取用户真的说过的事, **不要编造、不要润色成故事**
- 一句"我用 AI 做过很多事"这种没有具体内容的不算, 不要提取
- 用户没讲任何具体经历时, 返回空数组

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: { answers: { q: string; a: string }[] }): ContentPart[] {
    const answers = input.answers
      .map((item, idx) => `${idx + 1}. ${item.q}\n答: ${item.a.trim() || '(未作答)'}`)
      .join('\n\n');
    return [
      {
        type: 'text',
        text: `以下是创作者的访谈回答:\n\n${answers}\n\n按 schema 起草人物志五个字段与经历候选。`,
      },
    ];
  },
  responseSchema: VoiceDraftResponseSchema,
};
