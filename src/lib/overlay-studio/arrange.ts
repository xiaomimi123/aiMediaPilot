import type { CallStructuredOpts } from '@/lib/llm/vision';
import { OverlayArrangementSchema, describeArrangementIssues, type OverlayArrangement } from './arrangement';
import { OVERLAY_ARRANGE } from '@/lib/llm/prompts/overlay-arrange';
import type { OverlayLintResult } from './studio';

export type ArrangeLLM = {
  callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: unknown }>;
};

export interface TranscriptLine {
  startSec: number;
  endSec: number;
  text: string;
}

/** 与 buildFilmPlan 同款上限: 两轮修不好就明确失败, 不无限烧。 */
export const MAX_ARRANGE_REPAIR_ROUNDS = 2;

/**
 * SRT → Overlay Studio 编排 JSON(2026-09-20)。
 *
 * 结构与 `buildFilmPlan` 同源的三段循环: 调模型 → 结构校验(zod, 报错带实际值)
 * → 质量体检(Studio 自己的 lint CLI, 注入进来方便测试) → 有问题连同**原始
 * 逐句稿**一起喂回重排。lint 的输出本身就是中文、带卡号与数值的整句 ——
 * 天然满足"报错即契约", 原样透传, 不翻译不摘要。
 */
export async function buildOverlayArrangement(opts: {
  llm: ArrangeLLM;
  segments: TranscriptLine[];
  durationSec: number;
  runLint: (json: OverlayArrangement) => Promise<OverlayLintResult>;
  maxTokens?: number;
}): Promise<{ arrangement: OverlayArrangement; rounds: number; warns: string[] }> {
  const systemPrompt = OVERLAY_ARRANGE.buildSystemPrompt();
  const originalUserMessage = OVERLAY_ARRANGE.buildUserMessage(opts.segments, opts.durationSec);
  // 每轮 = 原始逐句稿 + 本轮问题(不许拿问题清单顶替原稿 —— buildFilmPlan 的
  // "失忆重写"故障教的, 见该文件 originalUserMessage 注释)。
  let userMessage = originalUserMessage;
  let lastIssues: string[] = [];

  for (let round = 0; round <= MAX_ARRANGE_REPAIR_ROUNDS; round += 1) {
    const { result } = await opts.llm.callStructured({
      systemPrompt,
      userMessage,
      responseSchema: OVERLAY_ARRANGE.responseSchema,
      maxTokens: opts.maxTokens ?? 8000,
    });

    const parsed = OverlayArrangementSchema.safeParse(result);
    let issues: string[];
    let warns: string[] = [];
    if (!parsed.success) {
      issues = describeArrangementIssues(result);
    } else {
      const lint = await opts.runLint(parsed.data);
      issues = lint.ok ? [] : lint.errors;
      warns = lint.warns;
    }

    if (issues.length === 0 && parsed.success) {
      return { arrangement: parsed.data, rounds: round, warns };
    }

    lastIssues = issues;
    userMessage = [
      ...originalUserMessage,
      {
        type: 'text',
        text: '上一版编排有以下必须修的问题, 逐条修掉, **其余保持不变**, 重新输出完整 JSON:\n'
          + issues.map((s) => `- ${s}`).join('\n'),
      },
    ];
  }

  throw new Error(`特效编排修了 ${MAX_ARRANGE_REPAIR_ROUNDS} 轮仍不合格:\n${lastIssues.join('\n')}`);
}
