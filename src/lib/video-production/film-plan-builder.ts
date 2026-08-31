import type { CallStructuredOpts } from '@/lib/llm/vision';
import { FILM_PLAN, type ActWindow } from '@/lib/video-production/film-plan-prompt';
import { checkFilmPlanTiming } from '@/lib/video-production/film-plan-timing';
import { FilmPlanSchema, type FilmPlan } from '@/lib/video-production/shot-plan';

/**
 * 最多修几轮。
 *
 * 实测(三轮探针, 三条真实六幕稿): 一次通过率 0/3 → 2/3 → 3/3, 需要修的那几次
 * **都在第一轮内收敛**, 一次都没用到第 3 次尝试。2 轮是有余量的数字, 不是猜的。
 */
export const MAX_REPAIR_ROUNDS = 2;

export type FilmPlanLLM = {
  callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: unknown }>;
};

/**
 * 把问题列表拼成给模型的修复指令。
 *
 * **这段文字是契约的一部分, 不是日志。** 实测教训: `z.union` 报的 `invalid_union`
 * 把四个卡片分支的失败并排输出, 模型读到排第一的 statement 分支
 * 「Unrecognized key(s): 'label','value','suffix'」之后, 三条稿子无一例外地**放弃
 * 整张 `stat` 卡**(存活率 0/3), 而不是去修那个字段。错误信息不是在教它改类型,
 * 是在教它别用这张卡。所以这里只讲"哪一条路径上是什么问题、该怎么改",
 * 绝不把其它分支的噪音带进来。
 */
export function formatIssuesForModel(issues: string[]): string {
  return [
    '你上一版的方案有下面这些问题，请**只修这些问题**，其余部分原样保留：',
    ...issues.map((i, n) => `${n + 1}. ${i}`),
    '',
    '重新输出完整的 JSON（同样只有 shots 一个顶层字段），不要解释文字。',
  ].join('\n');
}

/** zod 的 issue → 一句人话。`discriminatedUnion` 保证了这里拿到的是单一分支的问题。 */
function describeZodIssues(plan: unknown): string[] {
  const r = FilmPlanSchema.safeParse(plan);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const path = i.path.join('.');
    return path ? `${path}: ${i.message}` : i.message;
  });
}

/**
 * 产出 FilmPlan, 带修复循环。
 *
 * 为什么不用 `callStructured` 的 `responseSchema` 直接上 `FilmPlanSchema`:
 * 那样失败时是它自己按原样重试并最终抛错, 我们**拿不到模型的原始产出, 也就没有机会
 * 把精准的错误喂回去**。修复循环的全部价值在错误措辞上, 所以校验必须由我们自己做。
 */
export async function buildFilmPlan(opts: {
  llm: FilmPlanLLM;
  windows: ActWindow[];
  cardsSection: string;
  factsSection: string;
  totalMs: number;
}): Promise<{ plan: FilmPlan; rounds: number }> {
  const systemPrompt = FILM_PLAN.buildSystemPrompt(opts.cardsSection, opts.factsSection);
  let userMessage = FILM_PLAN.buildUserMessage(opts.windows);
  let lastIssues: string[] = [];

  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round += 1) {
    const { result } = await opts.llm.callStructured({
      systemPrompt,
      userMessage,
      responseSchema: FILM_PLAN.responseSchema,
    });

    const parsed = FilmPlanSchema.safeParse(result);
    const issues = parsed.success
      ? checkFilmPlanTiming(parsed.data, opts.totalMs)
      : describeZodIssues(result);

    if (issues.length === 0 && parsed.success) {
      return { plan: parsed.data, rounds: round };
    }

    lastIssues = issues;
    userMessage = [{ type: 'text', text: formatIssuesForModel(issues) }];
  }

  throw new Error(`FilmPlan 修了 ${MAX_REPAIR_ROUNDS} 轮仍不合格:\n${lastIssues.join('\n')}`);
}
