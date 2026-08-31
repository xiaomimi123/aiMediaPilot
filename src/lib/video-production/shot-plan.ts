import { z } from 'zod';

/**
 * 填槽契约(二十五期)——**Builder 不再写代码**。
 *
 * 二十四期实测: 版面骨架下发了、模型也照做了, 产出仍然是幻灯片, 因为骨架用的
 * 就是幻灯片语汇。**只要画面由模型的审美决定, 画质上限就是模型的审美。**
 *
 * 所以把画面从"模型写的 HTML"换成"模型选卡片 + 填槽位", 画质由我们写的卡片组件
 * 保证。schema 的职责是让"自由发挥"在解析阶段就失败 —— 用 `.strict()` 拒绝
 * 多余字段, 模型想偷偷塞坐标进来是不行的。
 */

export const CARD_TYPES = ['statement', 'stat', 'contrast', 'list'] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** 每种卡片的槽位。`.strict()` 是关键: 多一个字段就解析失败。 */
const SLOTS = {
  statement: z.object({
    text: z.string().min(1).max(24),
    sub: z.string().max(20).optional(),
  }).strict(),

  stat: z.object({
    label: z.string().min(1).max(16),
    value: z.number(),
    prefix: z.string().max(6).optional(),
    suffix: z.string().max(6).optional(),
    note: z.string().max(24).optional(),
  }).strict(),

  contrast: z.object({
    leftLabel: z.string().min(1).max(12),
    leftText: z.string().min(1).max(16),
    rightLabel: z.string().min(1).max(12),
    rightText: z.string().min(1).max(16),
    /** 中间的连接符。**不可省** —— 少了它就只是两张卡并排摆着, 不构成一个论断。 */
    connector: z.enum(['arrow', 'versus', 'plus']),
  }).strict(),

  list: z.object({
    title: z.string().min(1).max(16),
    /** 条目数下限 3: 少于 3 条用不着列表, 用 statement 更好。 */
    items: z.array(z.string().min(1).max(20)).min(3).max(8),
  }).strict(),
} as const;

/**
 * 每种卡片类型对应的分镜 schema。
 *
 * 注意: 这里刻意不用 `discriminatedUnion(...).refine(...)` —— 二者组合在这个
 * zod 版本下会触发类型报错(discriminatedUnion 返回的联合类型与 refine 的
 * 输入类型推导冲突)。改用 `z.union(...)` 描述"选哪种卡片、填哪套槽位"，
 * `endMs > startMs` 的校验挪到顶层 `superRefine` 里统一做 —— 断言行为不变，
 * 只是校验的位置从"每个分支各自 refine"改成"顶层集中 refine"。
 */
const SHOT_VARIANTS = CARD_TYPES.map((card) =>
  z.object({
    shotId: z.string().min(1),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(1),
    card: z.literal(card),
    slots: SLOTS[card],
  }).strict(),
) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]];

export const ShotPlanSchema = z.union(SHOT_VARIANTS).superRefine((s, ctx) => {
  const shot = s as { startMs: number; endMs: number };
  if (shot.endMs <= shot.startMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'endMs 必须大于 startMs',
      path: ['endMs'],
    });
  }
});

export type ShotPlan = z.infer<typeof ShotPlanSchema>;

export const FilmPlanSchema = z.object({
  shots: z.array(ShotPlanSchema).min(1),
}).superRefine((p, ctx) => {
  const sorted = [...p.shots].sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].startMs < sorted[i - 1].endMs) {
      /*
       * 时间轴重叠 = 两镜同时在演。这正是我们自建管线**既查不出也描述不了**的那类
       * 结构问题(裸 GSAP timeline 没有 track/clip 概念), 在这里作为契约的一部分拦掉。
       */
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '分镜时间轴不许重叠',
        path: ['shots'],
      });
      return;
    }
  }
});

export type FilmPlan = z.infer<typeof FilmPlanSchema>;

/**
 * 给导演提示词用的卡片说明。
 *
 * **必须写"什么时候用"而不只是列字段** —— 只列字段的话模型会挑最省事的那张
 * (实测: 它会把所有内容都塞进 statement), 卡片库再大也用不上。
 */
export function describeCardsForPrompt(): string {
  return [
    '可用的画面卡片（每一镜必须选且只选一种，并填满它的槽位）：',
    '',
    '- `statement`：一句判断占据画面。**什么时候用**：开场、转折、收尾这类需要停顿的地方。槽位：text（≤24 字）、sub（可选，≤20 字）。',
    '- `stat`：一个数字是主角，从 0 数上去。**什么时候用**：这一镜的重点就是某个具体数值时。槽位：label、value（数字本身，不带单位）、prefix/suffix（可选，单位与限定词放这里）、note（可选注脚）。',
    '- `contrast`：左右两组东西 + 中间连接符。**什么时候用**：讲 A 与 B 的对照或转变。槽位：leftLabel/leftText、rightLabel/rightText、connector（arrow 表示变成、versus 表示对立、plus 表示叠加）。**连接符不可省**——少了它就只是两张卡并排摆着，不构成一个论断。',
    '- `list`：一份条目清单。**什么时候用**：用"多"本身说明问题时。槽位：title、items（3~8 条，每条 ≤20 字）。少于 3 条请改用 statement。',
    '',
    '不要输出坐标、颜色、字号、动画参数——版面与动效由渲染层决定，你只负责选型与填字。',
  ].join('\n');
}
