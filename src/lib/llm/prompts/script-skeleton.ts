import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import { ACT_KEYS, ACT_LABELS, type ActKey } from '@/lib/script/six-act';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 骨架模式的六幕稿(v5)。
 *
 * 和完整初稿模式的区别只有一条, 但那一条是全部: **台词留空**。
 *
 * 为什么要有这个模式: 这个工具的分工是「系统给起点 → 你自己写 → 系统做评估」。
 * 完整初稿最容易把人带向 AI 的表达 —— 眼前摆着一段通顺的话, 你会本能地在它上面
 * 改几个词就交差, 而那段话 AI 也会写给别人。骨架模式只告诉你「这一幕该干什么、
 * 该多长、手里有什么材料」, 台词必须你自己写。
 *
 * 所以这个 prompt 里最重要的一句是: **不要写任何可以直接念的句子**。模型的默认
 * 倾向是帮人把话说完, 不明令禁止它就会在 guide 里塞一句现成台词。
 */

const SkeletonActSchema = z.object({
  act: z.enum(ACT_KEYS),
  /** 这一幕的小标题, 一句话概括它承担什么 */
  title: z.string().min(2).max(24),
  /** 这一幕该干什么。是指令不是台词。 */
  guide: z.string().min(8).max(200),
  /** 该覆盖的关键词, 供写的时候对照 */
  beats: z.array(z.string().min(1).max(20)).min(1).max(4),
  /**
   * 这一幕**需要什么样的材料**, 不是断言使用者有什么材料。
   * 例如「一个具体的失败细节, 带数字更好」, 而不是「14岁卖掉了第一家公司」。
   */
  materialNeeds: z.array(z.string().min(2).max(120)).min(0).max(3),
});

export const ScriptSkeletonResponseSchema = z.object({
  acts: z.array(SkeletonActSchema).length(ACT_KEYS.length),
  /** 整条片子的一句话主张 —— 写之前先知道要说服什么 */
  thesis: z.string().min(6).max(120),
  /** 写之前值得先想清楚的问题, 逼出你自己的判断 */
  questions: z.array(z.string().min(6).max(120)).min(2).max(4),
});

export type ScriptSkeletonResponse = z.infer<typeof ScriptSkeletonResponseSchema>;

function buildSystemPrompt(niche: string, personaSection: string, voiceSection: string): string {
  const acts = ACT_KEYS.map((k) => `${k}(${ACT_LABELS[k as ActKey]})`).join(' → ');

  return `${getExpertPersona(niche)}
${personaSection}${voiceSection}

任务: 为一条真人口播短视频搭**六幕骨架**。六幕固定为: ${acts}

**这一条压倒一切: 不要写任何可以直接念出口的句子。**
使用者会自己写台词 —— 那是他的一手体感, AI 替代不了, 同行也替代不了。你的活儿是
让他知道每一幕该干什么, 而不是替他把话说完。

guide 写「这一幕要完成什么动作」, 例如:
  ✓「用一件具体的、他亲身经历过的糟糕时刻开场, 让人立刻对号入座」
  ✗「你有没有过这种时候, 装个软件装到半夜」← 这是台词, 不许出现
guide 里出现引号包着的成句、或者任何能直接念的话, 都算违规。

beats 是这一幕该覆盖的关键词, 不是句子。
materialNeeds 只说「这里需要一个什么样的材料」, **绝不断言使用者有什么材料**:
  ✓「一个具体的失败细节, 带数字更好」
  ✓「一句他当时的真实想法, 越具体越好」
  ✗「14岁卖掉了第一家公司」← 这是在编他的人生, 严重违规
  ✗「他花了几百块算力」← 除非「我的素材」里真有这条, 否则不许出现

**研究材料是第三方信息, 不是使用者的经历。** 它可以帮你判断这个选题有什么可讲,
但绝不能被写成「他做过什么」。搞混这两者会让使用者对着一段别人的人生写稿。

只有下面「我的素材」一节里列出的东西, 才是使用者本人真有的。可以在 materialNeeds
里点名它们。

questions 是写之前值得先想清楚的问题, 用来逼出使用者自己的判断 —— 例如
「你当时最崩溃的是哪一刻?」比「介绍一下背景」有用得多。

${JSON_STRICTNESS}`;
}

function buildUserMessage(input: {
  topic: string;
  durationSec: number;
  actSeconds: Record<string, number>;
  brief?: unknown;
  /** 使用者素材库里的真实材料 —— 只有这些是他本人真有的。 */
  materials?: { kind: string; content: string }[];
}): ContentPart[] {
  const budget = ACT_KEYS.map((k) => `${ACT_LABELS[k as ActKey]} ${input.actSeconds[k] ?? 0} 秒`).join(' / ');

  const mine = input.materials?.length
    ? `\n\n我的素材(**只有这些是使用者本人真有的**, materialNeeds 里可以点名):\n${input.materials
        .map((m) => `- [${m.kind}] ${m.content.slice(0, 120)}`)
        .join('\n')}`
    : '\n\n我的素材: 空。materialNeeds 只能描述「需要什么样的材料」, 不许断言他有什么。';

  const brief = input.brief
    ? `\n\n研究材料(**第三方信息, 不是使用者的经历**, 只用来判断这个选题有什么可讲):\n${JSON.stringify(input.brief).slice(0, 2500)}`
    : '';

  return [
    {
      type: 'text',
      text: `选题: ${input.topic}\n全片 ${input.durationSec} 秒。各幕时长预算: ${budget}${mine}${brief}\n\n按 schema 输出骨架。记住: 不写台词, 不编他的人生。`,
    },
  ];
}

export const SCRIPT_SKELETON = {
  buildSystemPrompt,
  buildUserMessage,
  responseSchema: ScriptSkeletonResponseSchema,
};

/**
 * 骨架 → 六幕稿的 acts 形状。
 *
 * narration 一律空串 —— 这是骨架模式的全部意义所在。guide 放进 note, 使用者写的
 * 时候在「备注」栏能一直看着它。
 */
export function skeletonToActs(
  res: ScriptSkeletonResponse,
  actSeconds: Record<string, number>,
): {
  act: string;
  title: string;
  narration: string;
  visual: string;
  note: string;
  targetSec: number;
  beats: { keyword: string }[];
  facts: never[];
}[] {
  return res.acts.map((a) => ({
    act: a.act,
    title: a.title,
    narration: '',
    visual: '',
    note:
      a.materialNeeds.length > 0
        ? `${a.guide}\n需要的材料: ${a.materialNeeds.join('; ')}`
        : a.guide,
    targetSec: actSeconds[a.act] ?? 0,
    beats: a.beats.map((keyword) => ({ keyword })),
    facts: [],
  }));
}
