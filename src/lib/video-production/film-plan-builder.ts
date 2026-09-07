import type { CallStructuredOpts } from '@/lib/llm/vision';
import { FILM_PLAN, type ActWindow } from '@/lib/video-production/film-plan-prompt';
import { checkFilmPlanTiming } from '@/lib/video-production/film-plan-timing';
import { FilmPlanSchema, stripPlanStyle, type FilmPlan } from '@/lib/video-production/shot-plan';

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

/**
 * 提示词里**已经规定了处置办法**的那几种问题, 报错必须复述那个办法。
 *
 * 三十三期实测: 45 次真实运行里整片失败 10 次, 头号原因是 `list` 条目不足 3 条(5 次),
 * 而且都是**两轮修复之后仍然失败**。根因不是模型笨, 是两句话打架 ——
 * `facts-guard` 里写着「凑不满 3 条(items 下限)就换用 statement, 宁可用一句真话,
 * 也不要用编出来的第四条」; 而修复循环喂回去的是 zod 原文
 * 「Array must contain at least 3 element(s)」, 字面意思是"再加一条"。模型听了更近、
 * 更具体的那句去凑数, 可事实纪律又不许它编 —— 于是它在两条互斥的指令之间反复过不去。
 *
 * 与二十七期 `z.union` 那次同一类: **报错措辞是契约, 不是日志**。
 *
 * 只翻译"有既定处置办法"的问题。像 label 超长这种能直接改短的, 保持 zod 原文 ——
 * 为了统一而把所有报错都含糊成一套话术, 会毁掉那些本来就清楚的报错。
 */
function remedyFor(
  issue: { code: string; path: (string | number)[]; message: string },
  plan: unknown,
): string | null {
  const path = issue.path;
  const cardOf = (shotIdx: unknown): string | undefined => {
    const shots = (plan as { shots?: unknown[] })?.shots;
    if (!Array.isArray(shots) || typeof shotIdx !== 'number') return undefined;
    return (shots[shotIdx] as { card?: string } | undefined)?.card;
  };

  // list 的条目下限: 唯一的处置办法是换卡, 不是补条目。
  if (
    path[0] === 'shots' && path[2] === 'slots' && path[3] === 'items'
    && cardOf(path[1]) === 'list' && issue.code === 'too_small'
  ) {
    const shots = (plan as { shots?: Array<{ slots?: { items?: unknown[] } }> }).shots;
    const got = shots?.[path[1] as number]?.slots?.items?.length ?? 0;
    return `shots.${path[1]}: 这一镜用了 list 卡, 但只有 ${got} 条内容 —— list 至少要 3 条。`
      + `**不要为了凑够 3 条去编第三条**。稿子和事实清单里如果确实只有 ${got} 条, `
      + `就把这一镜改成 statement 卡(把最要紧的那一条写进 text, 次要的放 sub), `
      + `宁可用一句真话, 也不要用编出来的第三条。`;
  }

  return null;
}

/** zod 的 issue → 一句人话。`discriminatedUnion` 保证了这里拿到的是单一分支的问题。 */
export function describeZodIssues(plan: unknown): string[] {
  const r = FilmPlanSchema.safeParse(plan);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const remedy = remedyFor(i as unknown as { code: string; path: (string | number)[]; message: string }, plan);
    if (remedy) return remedy;
    const path = i.path.join('.');
    return path ? `${path}: ${i.message}` : i.message;
  });
}

/**
 * 输出疑似被截断时的判定阈值——`completionTokens` 逼近 `maxTokens` 到这个比例,
 * 就认为模型是被截断的, 而不是碰巧写到这么长。
 *
 * 见下面 `buildFilmPlan` 的截断检测注释: 180 秒六幕稿真机复现过"修 2 轮仍不合格",
 * 离线探针查出真正原因不是截断(见该注释), 但探针同时确认三轮
 * `completionTokens` 都远低于任何输出上限——**没有实测到过真正的截断个案**。
 * 这道检测是防御性的、面向"稿子更长以后"的兜底, 阈值先按经验值定, 之后如
 * 有真实截断个案再回来校准。
 */
const TRUNCATION_RATIO = 0.95;

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
  /**
   * 传给 `callStructured` 的输出 token 上限, 同时也是截断检测的分母。
   * 不传就不设上限(走 API 默认值), 也就不做截断检测——历史行为不变。
   */
  maxTokens?: number;
  /**
   * 提示词来源(二十九期 Task 4)。默认 `FILM_PLAN`(图文口播/插画配音——铺满不留
   * 空档)。出镜链传 `FILM_PLAN_BROLL`(不要求铺满, 见该常量顶部注释)。
   * 两条提示词共用同一套修复循环机制(截断检测/原始台词回填/issue 措辞约定),
   * 不为出镜链另写一份 buildFilmPlan——差异只在"这一轮该怎么校验/怎么问模型",
   * 不在"怎么跑修复循环"。
   */
  prompt?: { buildSystemPrompt: (cardsSection: string, factsSection: string) => string; buildUserMessage: (windows: ActWindow[]) => ReturnType<typeof FILM_PLAN.buildUserMessage> };
  /**
   * 时间轴校验函数(二十九期 Task 4)。默认 `checkFilmPlanTiming`(查空档/超出
   * 总时长/须从 0 开始)。出镜链传 `checkBrollPlanTiming`(不查空档, 见该函数
   * 顶部注释)。
   */
  checkTiming?: (plan: FilmPlan, totalMs: number) => string[];
}): Promise<{ plan: FilmPlan; rounds: number }> {
  const prompt = opts.prompt ?? FILM_PLAN;
  const checkTiming = opts.checkTiming ?? checkFilmPlanTiming;
  const systemPrompt = prompt.buildSystemPrompt(opts.cardsSection, opts.factsSection);
  /*
   * `originalUserMessage` 必须留着、每一轮都带上——**这是这次真实故障的根因**。
   *
   * 180 秒六幕稿真机复现: 第 0 轮模型产出的 27 镜其实完整覆盖了全部 164600 毫秒,
   * 只挂在一条无关的 `list` 卡条目数不够上; 但第 1 轮把 `userMessage` **整个替换**
   * 成只有 issue 文本的修复指令后, 模型看不到原始的逐幕台词和时间窗、也看不到自己
   * 上一版写了什么——它只能凭 system prompt 里残留的只言片语"回忆"整篇内容, 于是
   * 生生编出一份短得多的方案(10 镜, 只到 18000 毫秒); 第 2 轮同样丢了上下文, 又
   * 编出一份更短的(7 镜, 15000 毫秒)。三轮 `completionTokens` 分别只有 1890/491/510,
   * 离任何输出上限都很远——不是被截断, 是**每一轮修复指令都让模型在没有原文的情况下
   * 凭空重写全篇**, 稿子越长、这种"失忆重写"和真实时长的差距就越大。
   *
   * 60 秒稿的历史实测(见 MAX_REPAIR_ROUNDS 的注释)之所以没暴露这个问题, 是因为
   * 那几次要么 0 轮就过、要么 1 轮就收敛——从没有连续两轮都命中这条路径, "失忆
   * 重写"造成的时长偏差在更短的稿子上也不那么容易触发"结尾黑屏"这条时长检查。
   *
   * 修法: 每一轮发给模型的 `userMessage` 都**在原始的逐幕台词/时间窗后面追加**
   * 这一轮的修复指令, 而不是拿修复指令去顶替原始内容——模型永远看得见它该覆盖
   * 的完整时间轴和台词, "只修这些问题、其余部分原样保留"才有东西可保留。
   */
  const originalUserMessage = prompt.buildUserMessage(opts.windows);
  let userMessage = originalUserMessage;
  let lastIssues: string[] = [];

  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round += 1) {
    const { result, usage } = await opts.llm.callStructured({
      systemPrompt,
      userMessage,
      responseSchema: FILM_PLAN.responseSchema,
      maxTokens: opts.maxTokens,
    });

    /*
     * 截断检测必须在解析/校验之前做——截断产物有可能碰巧拼出合法 JSON(比如截断点
     * 正好在数组元素边界), 混进修复循环只会白烧几轮 API 却查不出真正原因(这正是
     * 这次故障最初怀疑、最后靠探针排除掉的那条路)。`usage` 的具体形状由 `llm`
     * 实现决定(`FilmPlanLLM.usage` 类型是 `unknown`), 这里按鸭子类型读
     * `completionTokens`, 读不到就跳过检测, 不假设某个具体实现。
     */
    if (opts.maxTokens !== undefined) {
      const completionTokens = (usage as { completionTokens?: number } | null | undefined)
        ?.completionTokens;
      if (
        typeof completionTokens === 'number' &&
        completionTokens >= opts.maxTokens * TRUNCATION_RATIO
      ) {
        throw new Error(
          `FilmPlan 输出疑似被截断: completionTokens=${completionTokens} 逼近 maxTokens=${opts.maxTokens}` +
            '(稿件过长导致画面方案被截断, 请缩短稿件或拆分处理)。',
        );
      }
    }

    const parsed = FilmPlanSchema.safeParse(result);
    const issues = parsed.success
      ? checkTiming(parsed.data, opts.totalMs)
      : describeZodIssues(result);

    if (issues.length === 0 && parsed.success) {
      /*
       * `style` 是剪辑台(用户)专属字段, 提示词里从没提过它——但"没提过"不等于
       * "模型绝不会填", 出方案后立刻剥一遍才是真正的保证(三十二期)。
       */
      return { plan: stripPlanStyle(parsed.data), rounds: round };
    }

    lastIssues = issues;
    userMessage = [...originalUserMessage, { type: 'text', text: formatIssuesForModel(issues) }];
  }

  throw new Error(`FilmPlan 修了 ${MAX_REPAIR_ROUNDS} 轮仍不合格:\n${lastIssues.join('\n')}`);
}
