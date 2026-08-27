import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 口播稿评分 —— 软指标层(二十二期)。
 *
 * 只评「要判断」的五项。能量的(垫话、语速、合规词、信任声明)全部由
 * src/lib/cockpit/script-score.ts 的纯函数算完了, 不重复交给模型 ——
 * 模型数字数会数错, 而且同一稿两次跑分会飘。
 *
 * 评分标准来自用户自己拆解的两条真实爆款, 不是通用写作理论:
 * - 奥一「三天AI赚5000」(赞 3512, 藏 3036): 数字钩子 → 信任声明 → 三次试错递进 → 关键转向 → 结果 → 金句 → 普适化
 * - 王飞雨「skill卖到70个」(赞 2277, 藏 3391): 悬念提问 → 结论前置 → 三论点 → 诚实难点收尾
 */

const DimScoreSchema = (max: number) =>
  z.object({
    score: z.number().int().min(0).max(max),
    reason: z.string().min(2).max(200),
  });

export const SOFT_DIMENSION_META = [
  {
    key: 'hookPower',
    label: '钩子力度',
    max: 20,
    guide:
      '前 3 秒有没有抓住人。数字结果/悬念提问/身份反差任意一种都算; 纯背景交代(「去年我想做一个 X」)不算。' +
      '共鸣点出现得越晚扣得越狠 —— 出现在第 8 秒之后, 这项不给超过 12 分。',
  },
  {
    key: 'failureNarrative',
    label: '失败叙事',
    max: 15,
    guide:
      '有没有「我试了 A → 发现 B 问题 → 所以 C 判断」的真实试错。' +
      '注意区分: **认知转变不是失败**(「我忍了很久才想通」只能给一半分), 必须是真的做了但没成。' +
      '一笔带过的「遇到了很多问题」给 6-8 分, 展开成一个具体的坑才给满分。',
  },
  {
    key: 'pivotClarity',
    label: '关键转向',
    max: 10,
    guide: '全片最重要的那个判断说没说清楚, 是不是一句话就能让人复述出来。',
  },
  {
    key: 'resultCredibility',
    label: '结果可信',
    max: 10,
    guide:
      '结果是具体的还是含糊的; 有没有**验证动作**(发帖测需求、搜竞品、找人聊)把成功从运气变成方法。' +
      '只有结果没有验证动作, 这项不给超过 7 分。',
  },
  {
    key: 'punchline',
    label: '金句收束',
    max: 10,
    guide:
      '有没有把个人经历抽象成别人也能用的一句话(「技术不是门槛, 门槛在于…」这种句式)。' +
      '鸡汤(「重要的是执行力」)不算金句 —— 要具体到能照着做。',
  },
] as const;

export const SOFT_MAX = SOFT_DIMENSION_META.reduce((s, d) => s + d.max, 0);

export const ScriptSoftScoreResponseSchema = z.object({
  hookPower: DimScoreSchema(20),
  failureNarrative: DimScoreSchema(15),
  pivotClarity: DimScoreSchema(10),
  resultCredibility: DimScoreSchema(10),
  punchline: DimScoreSchema(10),
  /** 按性价比排序的改法 —— 只给分不给改法, 用户还是不知道下一步做什么。 */
  topFixes: z.array(z.string().min(4).max(200)).min(0).max(3),
});

export type ScriptSoftScoreResponse = z.infer<typeof ScriptSoftScoreResponseSchema>;

export interface SoftScoreDimension {
  key: string;
  label: string;
  score: number;
  max: number;
  reason: string;
}

/** 摊平成和硬指标同形状的数组 —— 前端一个组件渲染两层, 不写两套。 */
export function toSoftDimensions(res: ScriptSoftScoreResponse): SoftScoreDimension[] {
  return SOFT_DIMENSION_META.map((meta) => {
    const cell = res[meta.key as keyof ScriptSoftScoreResponse] as { score: number; reason: string };
    return { key: meta.key, label: meta.label, max: meta.max, score: cell.score, reason: cell.reason };
  });
}

function buildSystemPrompt(niche: string): string {
  const dims = SOFT_DIMENSION_META.map(
    (d) => `- ${d.key} (${d.label}, 满分 ${d.max}): ${d.guide}`,
  ).join('\n');

  return `${getExpertPersona(niche)}

任务: 你评审一条**真人口播短视频**的六幕逐字稿, 只评下面这五项, 每项给分并说明理由。

评分标准来自两条已验证的爆款结构, 按它们的口径打分:
- 「三天用AI赚5000」(赞 3512): 数字钩子+小白人设 → 信任声明 → 三次试错递进(每段: 尝试→失败→判断) → 关键转向 → 结果验证 → 金句 → 普适化结尾
- 「skill 怎么卖到 70 个」(赞 2277): 悬念提问钩子 → 一句话答案前置 → 三个论点 → 诚实点出难点收尾

评分维度:
${dims}

打分纪律:
- 分数要能区分好坏。全给 8 折以上等于没评 —— 该扣就扣, 并在 reason 里点名是哪一幕、哪一句的问题。
- reason 写具体的话, 不要写"可以更好"这种废话。
- 不要评语速、字数、垫话、是否有"不卖课"声明、画面是否合规 —— 这五项已经由程序算过了, 你重复评会和程序打架。
- topFixes 按**性价比**排序: 改动最小、涨分最多的放第一条。最多 3 条, 没有就给空数组。

${JSON_STRICTNESS}`;
}

interface ActInput {
  act: string;
  title: string;
  narration: string;
  targetSec: number;
}

function buildUserMessage(input: { acts: ActInput[] }): ContentPart[] {
  const body = input.acts
    .map((a, i) => `【第${i + 1}幕 ${a.act}】${a.title} (${a.targetSec} 秒)\n${a.narration}`)
    .join('\n\n');
  const total = input.acts.reduce((s, a) => s + a.targetSec, 0);

  return [{ type: 'text', text: `全片 ${total} 秒, 共 ${input.acts.length} 幕。\n\n${body}\n\n按 schema 输出评分。` }];
}

export const SCRIPT_SOFT_SCORE = {
  buildSystemPrompt,
  buildUserMessage,
  responseSchema: ScriptSoftScoreResponseSchema,
};
