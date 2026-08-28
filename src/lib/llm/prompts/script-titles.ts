import { z } from 'zod';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 标题 / 话题标签候选(二十三期)。
 *
 * **为什么标题可以交给 AI, 正文不行。**
 *
 * 正文是你的声音 —— AI 润色过的句子, AI 也会写给别人, 所以写稿链路一直只给起点
 * 和诊断, 不代写。标题不一样: 它是**包装**, 是给算法和滑动中的拇指看的一行字,
 * 不承载「谁在说话」。这条边界是这个功能存在的全部理由。
 *
 * 两件事让它区别于生成时顺带产出的那三个标题:
 * 1. **它读的是稿子正文, 不是主题词。** 生成时标题和正文是同一次输出, 你后来把
 *    正文改了多少它都不知道。这里每次都拿当前正文重出。
 * 2. **它对任何稿子都能跑** —— 包括你自己导入的。
 */

const TitleSchema = z.object({
  text: z.string().min(5).max(30),
  /** 数字 / 反差 / 问题 / 承诺 / 悬念。 */
  hookType: z.string().min(1).max(10),
});

export const ScriptTitlesResponseSchema = z.object({
  titles: z.array(TitleSchema).length(3),
  tags: z.array(z.string().min(1).max(12)).min(1).max(6),
});

export type ScriptTitlesResponse = z.infer<typeof ScriptTitlesResponseSchema>;

function buildSystemPrompt(): string {
  return `使用者写好了一支口播视频的稿子。给这支视频起标题, 并选话题标签。

## 你只写包装, 不碰内容

标题是给算法和滑动中的拇指看的一行字。正文是使用者自己的表达, 你**不要**在这里
复述、总结或者评价它 —— 你的输出只有标题和标签。

## 标题必须落在稿子上

**稿子里没有的事, 一个字都不许写进标题。**

  ✓ 稿子说「卡了两天」→ 标题可以写「卡了两天」
  ✗ 稿子没说天数 → 标题写「7天做出来」

编出来的数字是最危险的一种: 它读起来最像真的, 而观众点进来发现对不上, 掉的是
完播率和信任。任何数字、时间、单量、名称, 都要能在稿子里指出出处。

## 不要把收益写进标题

即使稿子里提到了变现数字, 标题里也不要出现「赚了多少」「月入」「涨粉多少」这类
表述。视频里说是叙事, 标题里挂出来就是收益承诺, 平台按诱导处理。

## 三个标题要不同型

三个标题分别用不同的钩子类型(数字 / 反差 / 问题 / 承诺 / 悬念), 不要三个同一种
说法换词。≤ 25 字。

## 话题标签

2-5 个, 用这个领域真实存在的话题词, 不要自创。不带 # 号。

${JSON_STRICTNESS}`;
}

function buildUserMessage(input: { topic: string; narration: string }): ContentPart[] {
  return [
    {
      type: 'text',
      // 给正文而不是只给主题: 标题要落在稿子实际说了什么上, 主题词撑不住这个约束
      text: `主题: ${input.topic}\n\n这是稿子的全文:\n\n${input.narration}`,
    },
  ];
}

export const SCRIPT_TITLES = {
  buildSystemPrompt,
  buildUserMessage,
  responseSchema: ScriptTitlesResponseSchema,
};

export interface TitleGrounding {
  grounded: boolean;
  /** 标题里出现、但稿子里找不到的数字。 */
  inventedNumbers: string[];
}

/** 「两」「二」这些在标题里常被写成阿拉伯数字, 反过来也一样。 */
const CN_DIGITS: Record<string, string> = {
  一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5',
  六: '6', 七: '7', 八: '8', 九: '9', 十: '10',
};

function numbersIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d+/g)) out.add(m[0]);
  for (const [cn, ar] of Object.entries(CN_DIGITS)) {
    if (text.includes(cn)) out.add(ar);
  }
  return [...out];
}

/**
 * 标题里的数字在稿子里能找到吗。
 *
 * **只查数字, 不查别的。** 编造的数字是最危险的一类: 它读起来最像真的, 而观众
 * 点进来发现对不上, 掉的是完播率和信任 —— 这套工具此前就吃过 AI 顺手编事实的亏。
 * 至于形容词夸不夸张, 那是风格判断, 交给你自己看。
 *
 * 中文和阿拉伯数字互认: 稿子写「整整两天」, 标题写「卡了2天」不算编造。
 */
export function checkTitleGrounding(narration: string, title: string): TitleGrounding {
  const inDraft = new Set(numbersIn(narration));
  const invented = numbersIn(title).filter((n) => !inDraft.has(n));
  return { grounded: invented.length === 0, inventedNumbers: invented };
}
