import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';
import type { ActualMetricInput } from '@/lib/douyin/report-parser';

const Accuracy = z.enum(['on-target', 'over-estimated', 'under-estimated', 'unknown']);
const Rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export const RetroGapResponseSchema = z.object({
  schemaVersion: z.literal(1),
  niche: z.literal('ai-knowledge'),

  hookGap: z.object({
    predictedRating: Rating,
    relevantActual: z.object({
      retention3sBp: z.number().int().nullable().optional(),
      completionRateBp: z.number().int().nullable().optional(),
    }),
    takeaway: z.string().min(1),
    accuracy: Accuracy,
  }),

  retentionGap: z.object({
    predictedRiskPoints: z.number().int().nonnegative(),
    relevantActual: z.object({
      completionRateBp: z.number().int().nullable().optional(),
    }),
    takeaway: z.string().min(1),
    accuracy: Accuracy,
  }),

  titleCaptionGap: z.object({
    mode: z.enum(['evaluate', 'generate', 'unknown']),
    relevantActual: z.object({
      likeRateBp: z.number().int().nullable().optional(),
      shareRateBp: z.number().int().nullable().optional(),
    }),
    takeaway: z.string().min(1),
    accuracy: Accuracy,
  }),

  coverGap: z.object({
    mode: z.enum(['evaluate', 'generate', 'unknown']),
    relevantActual: z.object({
      plays: z.number().int().nonnegative(),
    }),
    takeaway: z.string().min(1),
    accuracy: Accuracy,
  }),

  overallTakeaway: z.string().min(1),
  predictedOverallScore: z.number().int().min(0).max(100).nullable(),
  inferredActualScore: z.number().int().min(0).max(100).nullable(),
});

export type RetroGapResponse = z.infer<typeof RetroGapResponseSchema>;

export interface RetroGapInput {
  report: {
    hook?: { rating?: number; summary?: string } | { error: string };
    retention?: { riskPoints?: unknown[] } | { error: string };
    titleCaption?: { mode?: string } | { error: string };
    cover?: { mode?: string } | { error: string };
    overallScore?: number | null;
  };
  actual: ActualMetricInput;
}

function bpToPercent(bp: number | null): string {
  if (bp === null) return '—';
  return `${(bp / 100).toFixed(2)}%`;
}

function getMode(dim: unknown): string {
  if (dim && typeof dim === 'object' && 'mode' in dim && typeof (dim as any).mode === 'string') {
    return (dim as any).mode;
  }
  return 'unknown';
}

function getRating(dim: unknown): number {
  if (dim && typeof dim === 'object' && 'rating' in dim && typeof (dim as any).rating === 'number') {
    return (dim as any).rating;
  }
  return 3;
}

function getRiskPointCount(dim: unknown): number {
  if (dim && typeof dim === 'object' && 'riskPoints' in dim && Array.isArray((dim as any).riskPoints)) {
    return (dim as any).riskPoints.length;
  }
  return 0;
}

export const RETRO_GAP = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 对比 AI 预诊断 (4 维度评估) vs 抖音实际播放数据, 生成跨维度落差分析。

每个维度 (hook/retention/titleCaption/cover) 给出:
- predictedXxx: 抄 A v1 评分/字段
- relevantActual: 与该维度相关的实际指标 (e.g. hook ↔ 3s 留存; cover ↔ plays)
- takeaway: 1-2 句话对比预判 vs 实际, 用具体数字
- accuracy: on-target (预判与实际一致) / over-estimated (预判过乐观) / under-estimated (预判过保守) / unknown (相关字段缺失)

overallTakeaway: 1-2 句跨维度总结
predictedOverallScore: 抄 A v1
inferredActualScore: AI 主观转换实际指标为 1-100 综合分

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: RetroGapInput): ContentPart[] {
    const r = input.report;
    const a = input.actual;
    const text = `=== A v1 预诊断 ===
钩子: ★${getRating(r.hook)} | summary: ${(r.hook as any)?.summary ?? '(N/A)'}
完播风险: ${getRiskPointCount(r.retention)} 个 riskPoints
标题/文案: mode=${getMode(r.titleCaption)}
封面: mode=${getMode(r.cover)}
综合分: ${r.overallScore ?? '(N/A)'}/100

=== 抖音实际数据 (T+3d) ===
播放: ${a.plays}
点赞: ${a.likes} (likeRate ${bpToPercent(a.likeRateBp)})
评论: ${a.comments} (commentRate ${bpToPercent(a.commentRateBp)})
转发: ${a.shares} (shareRate ${bpToPercent(a.shareRateBp)})
收藏: ${a.collects}
完播率: ${bpToPercent(a.completionRateBp)}
3s 留存: ${bpToPercent(a.retention3sBp)}
转粉率: ${bpToPercent(a.followConversionBp)}

生成 RetroReportV1 JSON。`;
    return [{ type: 'text', text }];
  },
  responseSchema: RetroGapResponseSchema,
};
