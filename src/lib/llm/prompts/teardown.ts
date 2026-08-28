import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 对标视频拆解(v5 阶段 D3)。
 *
 * 这个 prompt 的口径直接照用户手工拆的那两份(「奥一·三天AI赚5000」3512 赞、
 * 「王飞雨·skill卖到70个」2277 赞): 分段 → 每段的**结构作用** → 手法 →
 * 归纳出一句结构公式。当前评分体系的六个软指标就是从那两份里提炼的, 所以这里
 * 产出的字段要能直接喂回评分与钩子库。
 *
 * 刻意**不让模型猜播放量或留存率** —— 它看不到那些数据, 猜出来的数字会被当成
 * 事实使用。
 */

export const TeardownResponseSchema = z.object({
  /** 一句话结构公式, 例如「数字钩子 → 信任声明 → 三次试错递进 → 关键转向 → 结果 → 金句 → 普适化」 */
  formula: z.string().min(6).max(200),
  segments: z
    .array(
      z.object({
        /** 这一段在讲什么 */
        summary: z.string().min(2).max(120),
        /** 结构作用: 钩子 / 信任声明 / 试错 / 关键转向 / 结果 / 金句 / 普适化 / 其它 */
        role: z.string().min(2).max(20),
        /** 用了什么手法 */
        technique: z.string().min(2).max(120),
      }),
    )
    .min(2)
    .max(12),
  /** 开场钩子的原句, 可直接进钩子库 */
  hooks: z.array(z.string().min(2).max(200)).min(0).max(3),
  /** 可以照搬到自己账号的做法 */
  takeaways: z.array(z.string().min(4).max(200)).min(1).max(5),
  /** 从这条片子能衍生出的选题, 可直接进灵感库 */
  topicIdeas: z.array(z.string().min(4).max(120)).min(0).max(5),
  /**
   * 人设手法 —— 这个人**怎么把自己立起来**的。
   *
   * 对做人设的账号来说这比结构更要紧: 同一套结构谁都能抄, 但「他是个什么人、
   * 凭什么信他」是这条片子真正的资产。
   */
  personaMoves: z
    .array(
      z.object({
        /** 手法名, 例如「示弱开场」「主动划清界限」「暴露具体损失」 */
        move: z.string().min(2).max(30),
        /** 原话或具体做法 */
        evidence: z.string().min(2).max(200),
        /** 它在观众心里建立了什么 */
        effect: z.string().min(2).max(120),
      }),
    )
    .min(0)
    .max(5),
  /** 一句话概括这个人给观众的印象 */
  personaSummary: z.string().min(4).max(120),
});

export type TeardownResponse = z.infer<typeof TeardownResponseSchema>;

function buildSystemPrompt(niche: string): string {
  return `${getExpertPersona(niche)}

任务: 你拆解一条**别人的**口播短视频, 从转写稿里还原它的结构。

拆解口径(照抄两条已验证爆款的拆法):
- 按结构作用分段, 每段标出「它在这条片子里干什么」而不是「它讲了什么内容」
- 结构作用常见有: 钩子 / 信任声明 / 试错 / 关键转向 / 结果验证 / 金句 / 普适化结尾
- formula 用箭头串起来, 是一句能照着写的公式, 不是评价
- takeaways 要具体到能照做的一步, 不要写「值得学习」这种话
- hooks 抄原句, 不要改写 —— 它要进钩子库, 改了就不是人家的写法了

**人设手法是这次拆解的重点**(读者做的是人设账号, 不是资讯号):
- personaMoves 找「他怎么让你信他 / 记住他 / 觉得他是自己人」的具体动作。例如:
  示弱开场(先承认自己菜)、主动划清界限(不卖课不带货)、暴露具体损失(花了几百块
  算力)、身份反差(纯小白却做成了)、把观众放在同一边(我们这种普通人)
- evidence 必须是原话或具体做法, 不要写「他很真诚」这种没法照做的评价
- effect 写它在观众心里建立了什么, 一句话
- personaSummary 用一句话说清「看完这条, 观众觉得他是个什么人」

纪律:
- **不要猜播放量、点赞、完播率这些数字。** 你看不到它们, 猜出来会被当成事实使用。
- 转写稿里有明显的听写错字时按上下文理解, 不要因为错字判错结构。
- 人设手法找不出来就给空数组, **不要为了凑数把普通表达说成手法** —— 那会让人去
  模仿一个根本不存在的技巧。
- 段落数按这条片子的真实结构来, 不要凑够某个数。

${JSON_STRICTNESS}`;
}

function buildUserMessage(input: { title: string; author: string; transcript: string }): ContentPart[] {
  const head = [input.title && `标题: ${input.title}`, input.author && `作者: ${input.author}`]
    .filter(Boolean)
    .join('\n');
  return [
    {
      type: 'text',
      text: `${head}\n\n口播转写:\n${input.transcript}\n\n按 schema 输出拆解。`,
    },
  ];
}

export const TEARDOWN = {
  buildSystemPrompt,
  buildUserMessage,
  responseSchema: TeardownResponseSchema,
};
