import { z } from 'zod';

/**
 * ScriptDraft.output / ContentAnalysis.report / InspirationInsight.output 都是 Json 列;
 * 写入路径由 zod schema 保护, 读回路径过去散落成 `as any` + `Array.isArray(...)` 手窄化。
 *
 * 这里定义"够用即可"的窄读取 schema — 只覆盖消费方真正用到的字段,
 * 而不是把全量生成 schema 拉进来. 意图: 读失败时给 null / 空数组 fallback,
 * 而不是抛错阻断页面。
 *
 * 好处:
 *  - 类型 + 运行时校验一致, 少 6+ 处 `as any`
 *  - schema 演化时 read path 明确会 null (方便 grep 到断点)
 *  - 消费方代码 (patterns/page, aggregate, checklist) 不再自己做 typeof/Array.isArray
 */

// ============ Analysis.report ============

const AnalysisReportReadSchema = z.object({
  overallScore: z.number().nullable().optional(),
  predictedPlaysRange: z
    .object({
      predicted: z.number(),
      lower: z.number(),
      upper: z.number(),
    })
    .partial()
    .optional(),
  // P3-18 后 worker 会写这两个字段: 4 维中有 fail 时 partial=true, available 只列成功的
  partial: z.boolean().optional(),
  availableDimensions: z.array(z.string()).optional(),
});
export type AnalysisReportRead = z.infer<typeof AnalysisReportReadSchema>;

export function readAnalysisReport(json: unknown): AnalysisReportRead | null {
  if (!json || typeof json !== 'object') return null;
  const parsed = AnalysisReportReadSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** 只返回 4 维全通过时的分。 用于 topPerformers / niche avg 等需要严格 comparable 的场景。 */
export function readOverallScore(json: unknown): number | null {
  const r = readAnalysisReport(json);
  if (r?.partial === true) return null;
  return typeof r?.overallScore === 'number' ? r.overallScore : null;
}

/** 允许 partial 的读取。 用于 trend 之类需要展示"哪怕不完整也画出来"的场景, 返回 score + partial 标位。 */
export function readOverallScoreWithMeta(
  json: unknown,
): { score: number; partial: boolean } | null {
  const r = readAnalysisReport(json);
  if (typeof r?.overallScore !== 'number') return null;
  return { score: r.overallScore, partial: r.partial === true };
}

export function readPredictedPlaysRange(
  json: unknown,
): { predicted: number; lower: number; upper: number } | null {
  const r = readAnalysisReport(json);
  const range = r?.predictedPlaysRange;
  if (
    !range ||
    typeof range.predicted !== 'number' ||
    typeof range.lower !== 'number' ||
    typeof range.upper !== 'number'
  ) {
    return null;
  }
  return { predicted: range.predicted, lower: range.lower, upper: range.upper };
}

// ============ Analysis.retroReport ============

const RetroReportReadSchema = z
  .object({
    predictedOverallScore: z.number().optional(),
    inferredActualScore: z.number().optional(),
  })
  .passthrough();

export function readRetroReport(json: unknown): {
  predictedOverallScore?: number;
  inferredActualScore?: number;
} | null {
  if (!json || typeof json !== 'object') return null;
  const parsed = RetroReportReadSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

// ============ ScriptDraft.output ============

const ScriptDraftOutputReadSchema = z
  .object({
    titles: z
      .array(
        z
          .object({
            text: z.string().optional(),
            hookType: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    hooks: z
      .array(z.object({ text: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

export type ScriptDraftOutputRead = z.infer<typeof ScriptDraftOutputReadSchema>;

export function readScriptDraftOutput(json: unknown): ScriptDraftOutputRead | null {
  if (!json || typeof json !== 'object') return null;
  const parsed = ScriptDraftOutputReadSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

// ============ InspirationInsight.output — recommendedTopics 是 /agent 首页读的字段 ============

const InspirationInsightReadSchema = z
  .object({
    recommendedTopics: z
      .array(
        z.object({
          title: z.string(),
          rationale: z.string(),
        }),
      )
      .optional(),
    hookTypes: z.array(z.string()).optional(),
    titlePatterns: z.array(z.string()).optional(),
    durationInsight: z.string().optional(),
  })
  .passthrough();

export type InspirationInsightRead = z.infer<typeof InspirationInsightReadSchema>;

export function readInspirationInsight(json: unknown): InspirationInsightRead | null {
  if (!json || typeof json !== 'object') return null;
  const parsed = InspirationInsightReadSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
