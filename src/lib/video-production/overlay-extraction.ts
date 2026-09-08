import type { CallStructuredOpts } from '@/lib/llm/vision';
import { OVERLAY_PLAN } from '@/lib/llm/prompts/overlay-plan';
import { OverlayExtractionSchema, type OverlayItem } from '@/lib/video-production/overlay-plan';
import { formatIssuesForModel } from '@/lib/video-production/film-plan-builder';

/**
 * 叠加层提取的修复循环, 与 `film-plan-builder.ts` 的 `buildFilmPlan` 同一先例
 * (轮数选择理由见该文件 `MAX_REPAIR_ROUNDS` 注释, 这里未观察到更长的提取任务
 * 需要更多轮, 沿用同一个数字)。
 */
export const OVERLAY_MAX_REPAIR_ROUNDS = 2;

export type OverlayExtractionLLM = {
  callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: unknown }>;
};

/**
 * zod 报错 → 一句人话。
 *
 * 这里只有一种字段会真的超限(`text` 的 14 字上限), 没有 `film-plan-builder.ts`
 * 那种"某几种问题有既定处置办法"的分支需要——直接用 `path: message` 就是精确的
 * 那一条, 不需要额外翻译。真正要守住的纪律是**只报这一条问题**, 不把 zod 对
 * 其它 items 元素的并列报错一起塞进同一条修复指令(同一先例见
 * `formatIssuesForModel` 顶部注释)。
 */
function describeOverlayIssues(raw: unknown): string[] {
  const parsed = OverlayExtractionSchema.safeParse(raw);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => {
    const path = i.path.join('.');
    return path ? `${path}: ${i.message}` : i.message;
  });
}

/**
 * 从转写提取文字叠加计划。**提取失败不拦片**(spec 红线): 两轮修复仍不合法时,
 * 不抛错, 返回空 `items` + 非空 `notice`, worker 据此把 notice 并进
 * `productionNotice` 继续往下渲染, 不因为这一层可选功能挡住整条片子出片。
 */
export async function extractOverlayPlan(opts: {
  llm: OverlayExtractionLLM;
  segments: { startMs: number; endMs: number; text: string }[];
  durationMs: number;
}): Promise<{ plan: { items: OverlayItem[] }; notice: string | null }> {
  const systemPrompt = OVERLAY_PLAN.buildSystemPrompt();
  const originalUserMessage = OVERLAY_PLAN.buildUserMessage({
    segments: opts.segments,
    durationMs: opts.durationMs,
  });
  let userMessage = originalUserMessage;
  let lastIssues: string[] = [];

  for (let round = 0; round <= OVERLAY_MAX_REPAIR_ROUNDS; round += 1) {
    const { result } = await opts.llm.callStructured({
      systemPrompt,
      userMessage,
      responseSchema: OverlayExtractionSchema,
    });

    const issues = describeOverlayIssues(result);
    if (issues.length === 0) {
      const parsed = OverlayExtractionSchema.parse(result);
      return { plan: { items: parsed.items as OverlayItem[] }, notice: null };
    }

    lastIssues = issues;
    userMessage = [...originalUserMessage, { type: 'text', text: formatIssuesForModel(issues) }];
  }

  return {
    plan: { items: [] },
    notice: `文字叠加层提取失败(修 ${OVERLAY_MAX_REPAIR_ROUNDS} 轮仍不合格): ${lastIssues.join('; ')}`,
  };
}
