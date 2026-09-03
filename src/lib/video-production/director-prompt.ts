import { z } from 'zod';
import type { ContentPart } from '@/lib/llm/vision';

export const ShotSchema = z.object({
  shotId: z.string().min(1),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  claim: z.string().min(1),
  visualJob: z.string().min(1),
  beats: z.array(z.object({
    visibleState: z.string().min(1),
    development: z.string().min(1),
  })).min(2).max(8),
  // 二十一期方向 B: 导演为这一镜指派的真实素材 id。可缺省 —— 没挂素材的任务照常解析。
  // 上一版把素材只给 Builder, 导演不知情就排不出"展示这张表"的镜头, Builder 只能
  // 见缝插针, 实测一次都没插 —— 所以改成由导演主动指派。
  assetIds: z.array(z.string()).optional(),
});
export type Shot = z.infer<typeof ShotSchema>;

export const DirectorResponseSchema = z.object({
  concept: z.string().min(1),          // 一句话视觉概念
  palette: z.array(z.string()).min(3).max(8), // 十六进制色值
  shots: z.array(ShotSchema).min(1),
});
export type DirectorResponse = z.infer<typeof DirectorResponseSchema>;

export const DIRECTOR = {
  /**
   * `factsSection` 为空(或不传)时输出与二十期之前字符级一致 —— 老任务零迁移。
   * 非空时由 `buildFactsSection` 产出, 自带前导换行(同 personaSection 的既有约定)。
   */
  buildSystemPrompt(factsSection?: string, styleSection?: string, assetSection?: string): string {
    const factsBlock = factsSection && factsSection.trim() ? factsSection : '';
    // 素材段(二十一期方向 B): 让导演知道手上有什么真材料, 并为它们专门排镜头
    const assetBlock = assetSection && assetSection.trim() ? assetSection : '';
    // 风格段(二十一期): 亮/暗基调与切镜节奏, 由模板配置驱动; 空串时输出不变
    const styleBlock = styleSection && styleSection.trim() ? styleSection : '';
    return `你是一个 B-roll 视频的"导演"，只负责影片的意义和视觉方向。

规则：
- 用 SRT 的整数毫秒作为时间真相，覆盖从 0 到最后一句结束。
- 把表达同一个意思的字幕行合并成一个镜头，在语义转折处切镜，不要机械按字幕行切分。
- 单个镜头不超过 40000 毫秒。
- 每个镜头要写清楚：观众理解到的主张(claim)、这个画面要完成的视觉任务(visualJob，如 clarify/reveal/compare/prove)、2-6 个"微节拍"(beats，每个节拍要说清楚画面变成了什么样(visibleState)以及这个变化本身是什么(development))。
- 每个镜头的 visualJob 要能对应一种**构图意图**，而不只是"展示这句话"：prove(摆证据)/compare(两组对照)/clarify(用体量说明)/reveal(揭示转折)。构图契约由画面层按 visualJob 选，你只需要把意图写准。
- 统一的调色板(palette)只给 3-8 个十六进制色值，覆盖全片使用。

${styleBlock}${factsBlock}${assetBlock}

只输出 JSON，不要 markdown 代码块标记，不要解释文字。字段：concept(一句话视觉概念)、palette(色值数组)、shots(镜头数组，每个镜头含 shotId/startMs/endMs/claim/visualJob/beats)。`;
  },
  buildUserMessage(srt: string): ContentPart[] {
    return [{ type: 'text', text: `完整 SRT 字幕：\n\n${srt}\n\n请给出完整的分镜方案。` }];
  },
  responseSchema: DirectorResponseSchema,
};

/**
 * 裁完短于这个就没意义了。
 *
 * 与 `film-plan-timing.ts` 的 `BROLL_MIN_SHOT_MS`(=1200, `checkBrollPlanTiming`
 * 在 FilmPlan 修复循环里用)不是同一件事、数值也故意不同, 别当成对不上的 bug
 * 误改成一致: 这里是**裁剪之后**"短于此就整镜丢弃"的硬下限, `BROLL_MIN_SHOT_MS`
 * 是**裁剪之前**"引导模型别排太短的镜"的软标准, 前者故意比后者松(1000 < 1200)——
 * 一镜从 FilmPlan 产出时的 1200ms 被这个函数按素材时长夹小到比如 1050ms 是正常的
 * "因裁剪而缩短、但仍然可用", 如果两个阈值相等, 这种镜头会在这里被误杀。
 */
const MIN_SHOT_MS = 1000;

/**
 * 把导演给的分镜裁回素材长度之内。
 *
 * **真实事故**: 出镜素材 155 秒, 导演却排出 234 秒的分镜(s7 从 155 秒开始、s8 到
 * 234 秒结束), 合成时照单全收地拼起来 —— 成片比素材长了 79 秒, 后面那 79 秒既没有
 * 人声也没有对应台词, 纯粹是凑出来的画面。
 *
 * 同一份稿子上一轮导演给的是 0~154 秒, 完全正常。所以这是模型的随机性, 而管线
 * **一条校验都没有**: 分镜是 LLM 出的, 出格是迟早的事, 不该指望它每次都对。
 *
 * 素材时长拿不到时**原样返回**: 宁可不裁, 也不要凭空裁错 —— 裁错会直接丢掉真实内容。
 */
export function clampShotsToSource<T extends { startMs: number; endMs: number }>(
  shots: T[],
  sourceDurationMs: number | undefined,
): T[] {
  if (!sourceDurationMs || sourceDurationMs <= 0) return shots;

  return shots
    .filter((s) => s.startMs < sourceDurationMs)
    .map((s) => (s.endMs > sourceDurationMs ? { ...s, endMs: sourceDurationMs } : s))
    .filter((s) => s.endMs - s.startMs >= MIN_SHOT_MS);
}
