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

/**
 * 历史数据兜底(2026-09-01)：改动之前落库的 `filmPlan` 里, `contrast` 槽位带
 * 着旧方案的 `connector` 字段。`.strict()` 拒绝多余字段是这份契约的核心
 * 设计, 不能为兼容旧数据而放松——但也不能让老片子在 master 渲染时因为一个
 * 已经废弃的字段直接解析失败。所以在真正的 `.strict()` 校验之前, 先把
 * `connector` 键原样丢掉(如果存在的话), 新数据本来就不带这个字段, 这一步
 * 对它是空操作。
 */
const stripLegacyConnector = (v: unknown): unknown => {
  if (v && typeof v === 'object' && 'connector' in (v as Record<string, unknown>)) {
    const { connector: _connector, ...rest } = v as Record<string, unknown>;
    return rest;
  }
  return v;
};

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

  /*
   * 二十八期推翻了这张卡原来的设计。原设计里 `connector` 要模型在
   * `arrow`/`versus`/`plus` 三个取值里选一个，理由是"少了它就只是两张卡并排
   * 摆着，不构成一个论断"。
   *
   * 但连续三轮真机实测（3 条真实六幕稿 × 3 遍，每轮约 20 处 contrast）测出来的
   * 是：总正确率在 61%~70% 之间来回摆（64.7% / 70% / 61.1%），n≈20 上这三个
   * 数彼此都落在噪声区间里，看不出谁比谁"更准"。更关键的是每一轮现象一致——
   * 只要收紧提示词让某个取值变准（比如第五轮把 arrow 从 33% 提到 75%），错误
   * 就整批迁移到另一个取值上（同一轮 plus 掉到 43%）。这是**零和搬运**，不是
   * 判断力在变强；说明模型在这道判定题上就是不具备把三个取值分开的能力，靠堆
   * 判定规程、加例子已经到顶（详见下面 describeCardsForPrompt 的历史注释）。
   *
   * 选错连接符不是"画面差一点"，是画面在断言一个原文没有的关系（"变成了"/
   * "二选一"/"同时成立"三选一，选错就是编了一个不存在的因果或取舍）。这个
   * 项目的事实纪律本来就不允许素材里没有明确关系时做断言式图形——一个 1/3
   * 概率错的断言不该出现在画面上。所以拍板去掉这道选择，`contrast` 改成渲染
   * 一个不表态的中性分隔件：画面仍是"左右两组+中间有东西连着"，但不再断言
   * 具体是哪种关系。等将来有能实测到 85% 以上的做法，再考虑把三个取值放回来。
   */
  contrast: z.preprocess(stripLegacyConnector, z.object({
    leftLabel: z.string().min(1).max(12),
    leftText: z.string().min(1).max(16),
    rightLabel: z.string().min(1).max(12),
    rightText: z.string().min(1).max(16),
  }).strict()),

  list: z.object({
    title: z.string().min(1).max(16),
    /** 条目数下限 3: 少于 3 条用不着列表, 用 statement 更好。 */
    items: z.array(z.string().min(1).max(20)).min(3).max(8),
  }).strict(),
} as const;

/**
 * `shotId` 只是个标识符, 不承载内容判断——模型该不该把它写成字符串跟"这镜该讲
 * 什么"毫无关系, 所以不该占用修复循环的额度。
 *
 * 实测(2026-08-31, 真机跑闲鱼AI服务稿): 提示词只说了"每一镜的字段是 shotId、
 * startMs、endMs、card、slots", 没规定 shotId 的类型, 模型自然把它当成"第几镜"
 * 填了整数 1/2/3。修复循环把 zod 的
 * `shots.0.shotId: Expected string, received number` 喂回去两轮, 模型两轮都
 * 没改——这条错误信息在教一个和内容无关的格式细节, 不像 `stat.value` 那样
 * 是模型能读懂"该怎么改"的语义错误。按 §2.2「格式化必须由系统兜住」的既定
 * 原则, 数字标识符在这里做类型宽松处理, 而不是继续赌模型会读懂这条反馈。
 */
const ShotIdSchema = z.preprocess(
  (v) => (typeof v === 'number' ? String(v) : v),
  z.string().min(1),
);

/** 分镜的公共字段。四种卡片只在 `card` 与 `slots` 上分岔。 */
const SHOT_BASE = {
  shotId: ShotIdSchema,
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
} as const;

const shotVariant = <T extends CardType>(card: T) =>
  z.object({ ...SHOT_BASE, card: z.literal(card), slots: SLOTS[card] }).strict();

/**
 * 每种卡片类型对应的分镜 schema。
 *
 * **必须是 `discriminatedUnion`，不能退回 `z.union`。** 这里曾经用过 `z.union` +
 * 顶层 `superRefine`(为绕开当时 `discriminatedUnion().refine()` 的类型报错)，当时
 * 判断"断言行为不变"—— 就接受/拒绝而言这话没错，**但错误信息变了，而修复循环吃的
 * 就是错误信息**，这个代价当时没看出来。
 *
 * 实测(2026-08-31，三条真实六幕稿)：`z.union` 在 `stat` 卡的 `value` 填成字符串时，
 * 报的是 `invalid_union`，里面并排装着四个分支各自的失败；真正有用的
 * `Expected number, received string` 排在第二个分支，而排第一的 statement 分支写着
 * 「Invalid literal value, expected "statement"」+「Unrecognized key(s): 'label',
 * 'value', 'suffix'」。把这段喂回给模型，它读到的字面意思是「这镜该用 statement，
 * 而 label/value/suffix 不是合法字段」—— 于是三条稿子无一例外地**放弃 `stat` 整张卡**，
 * 把数字揉进 statement 文本里。`stat` 的存活率是 0/3。
 * 错误信息不是在教它改类型，是在教它别用这张卡。
 *
 * `discriminatedUnion` 先按 `card` 选定分支，只报那一个分支的问题，
 * 修复循环拿到的才是可执行的指令。
 */
const SHOT_VARIANTS = [
  shotVariant('statement'),
  shotVariant('stat'),
  shotVariant('contrast'),
  shotVariant('list'),
] as const;

/**
 * 上面那个数组是手写的，不是从 `CARD_TYPES` 生成的(`discriminatedUnion` 需要字面量
 * 元组类型，`.map()` 出来的数组喂不进去)。手写就有漏写的风险 —— 加一张卡却忘了加
 * 分支，schema 会安静地拒绝那张新卡。这条断言让"忘了"在模块加载时就炸。
 */
{
  const covered = SHOT_VARIANTS.map((v) => v.shape.card.value as string);
  const missing = CARD_TYPES.filter((c) => !covered.includes(c));
  if (missing.length > 0) {
    throw new Error(`SHOT_VARIANTS 漏了卡片类型: ${missing.join(', ')}`);
  }
}

export const ShotPlanSchema = z.discriminatedUnion('card', SHOT_VARIANTS as unknown as [
  ReturnType<typeof shotVariant>, ReturnType<typeof shotVariant>, ...ReturnType<typeof shotVariant>[],
]).superRefine((s, ctx) => {
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
    '- `stat`：一个数字是主角，从 0 数上去。**什么时候用**：这一镜的重点就是**某一个确定的数值**时。槽位：label、value、prefix/suffix（可选，单位与限定词放这里）、note（可选注脚）。',
    '  - `value` 必须是**裸数字**（JSON 的 number）：写 `82`，不要写 `"82"`、`"82%"`、`"11000元"`。单位、正负号、"约"这类限定词一律放进 prefix/suffix。',
    '  - 画面是从 0 数到这个数的动画，所以**数不出来的东西不要用这张卡**：区间（300-500）、"翻倍""三倍"这类倍率、没有具体数值的概括。这些情况改用 statement 或 contrast，把数字写进文字里。',
    '- `contrast`：左右两组东西，中间用一个中性分隔件连起来。**什么时候用**：讲 A 与 B 的对照。槽位：leftLabel/leftText、rightLabel/rightText。',
    '  **不需要、也不能指定左右两边之间是什么关系**（没有这个字段可填）。三轮真机实测（3 条真实六幕稿 × 3 遍，每轮约 20 处 contrast）测出总正确率在 61%~70% 之间来回摆，且每轮现象一致：只要收紧判断规则让某个关系类型变准，错误就整批迁移到另一个类型上——这是**零和搬运**，不是判断力在变强，说明这道判定题超出了当前可控的范围。选错关系 = 画面在断言一个原文没有的因果或取舍，比不断言更糟，所以这一步已经拿掉：你只管把左右两组内容填对，连接件长什么样、表不表态由渲染层决定。',
    '- `list`：一份条目清单。**什么时候用**：用"多"本身说明问题时。槽位：title、items（3~8 条，每条 ≤20 字）。少于 3 条请改用 statement。',
    '',
    '不要输出坐标、颜色、字号、动画参数——版面与动效由渲染层决定，你只负责选型与填字。',
  ].join('\n');
}
