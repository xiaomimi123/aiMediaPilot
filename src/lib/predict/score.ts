import { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';
import { DIMS, type Dim } from './formula';

export const ScoreSchema = z.object({
  scores: z
    .array(
      z.object({
        dim: z.enum(DIMS),
        score: z.number().int().min(1).max(5),
        reason: z.string().min(1),
        quote: z.string(),
        segmentId: z.string().nullable(),
        fix: z.string(),
      }),
    )
    .length(5)
    .refine((xs) => new Set(xs.map((x) => x.dim)).size === 5, '5 个维度各打一次'),
});
export type DimScore = z.infer<typeof ScoreSchema>['scores'][number];

export interface ScoreInput {
  segments: { id: string; label: string; text: string; estSec: number }[] | null;
  transcript: string[] | null;
  persona: string;
  benchmark: string;
}

export const SCORE_SYSTEM = `你是抖音口播的流量评审，只根据稿子本身打分，不猜播放量。
抖音按观众行为推荐：前 2 秒有没有划走、前 5 秒有没有留下、平均看了多久、有没有看完、有没有点赞 / 收藏 / 评论 / 分享 / 关注。
按下面 5 个维度各打 1–5 的整数分（3 = 这个账号的平常水平）：
- hook 开头钩子：前 2 秒能否让人停下，前 5 秒是否给出看下去的理由。1 = 寒暄或铺垫开场；3 = 有具体承诺或反常识断言；5 = 具体生动、让人没法不看下去。
- pace 节奏与信息密度：有无注水段，信息点间隔，中段有无新钩子。1 = 大段重复或空话；3 = 平稳推进；5 = 每 5–8 秒都有新信息或新悬念。
- ending 结尾收束：结尾是否干脆，有无让人看完的回收。1 = 拖沓或草草结束；3 = 正常总结；5 = 回收开头悬念或有让人想看完的反转。
- interaction 互动引子：有无让人点赞、收藏、评论、分享、关注的理由。1 = 没有；3 = 一句泛泛的"点个赞"；5 = 有值得收藏的干货、能引发讨论的观点或明确的关注理由。
- topic 选题与受众：选题大众度、与账号定位的契合、对标背书。1 = 小众且偏离定位；3 = 定位内常规选题；5 = 定位内、受众广、有对标爆款验证。
每个维度给：score、reason（一句理由）、quote（作为依据的原句，没有就空串）、segmentId（原句所在段落 id，按口播打分时为 null）、fix（3 分以下必须写一句怎么改，3 分及以上可以空串）。
只输出 JSON：{"scores": [{"dim": "hook", "score": 3, "reason": "…", "quote": "…", "segmentId": "s1", "fix": "…"}, …共 5 项]}。`;

export function buildScoreMessage(i: ScoreInput): string {
  const body = i.segments
    ? `【稿子】\n${i.segments.map((s) => `[${s.id}] ${s.label}（约 ${s.estSec} 秒）\n${s.text}`).join('\n\n')}`
    : `【实际口播（逐句）】\n${(i.transcript ?? []).join('\n')}`;
  return [i.persona ? `【账号定位】\n${i.persona}` : '', i.benchmark ? `【对标拆解】\n${i.benchmark}` : '', body].filter(Boolean).join('\n\n');
}

export async function scoreScript(llm: StructuredLLM, i: ScoreInput): Promise<DimScore[]> {
  const { result } = await llm.callStructured({ systemPrompt: SCORE_SYSTEM, userMessage: [{ type: 'text', text: buildScoreMessage(i) }], responseSchema: ScoreSchema });
  return result.scores;
}

export const scoreMap = (scores: DimScore[]) => Object.fromEntries(scores.map((s) => [s.dim, s.score])) as Record<Dim, number>;
