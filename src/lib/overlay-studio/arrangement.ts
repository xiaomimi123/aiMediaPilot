import { z } from 'zod';

/**
 * Overlay Studio 编排 JSON 的结构契约(2026-09-20)。
 *
 * 形状对齐它的 skill 输出格式(version/theme/cards[kind,start,end,seg,params])。
 * 校验哲学与 FilmPlanSchema 同源: 结构错误在解析阶段就失败、报错带实际值 ——
 * 但**只管结构, 不管编排质量**: 密度/越界/占位这些规则属于 Studio 自己的
 * 体检器(lint CLI), 我们调它而不是复刻它(阈值在它那边, 用户还能 local 覆盖)。
 */

export const OVERLAY_KINDS = [
  'chapter-bar', 'pin-board', 'caption-track',
  'stat-proof', 'ring-metric', 'odometer', 'rank-bars', 'growth-curve',
  'versus-card', 'quote-lockup', 'punch-pill',
  'step-timeline', 'checklist', 'term-card', 'ui-callout',
  'blur-text', 'type-shift', 'entity-chips', 'focus-card', 'terminal-3d',
] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

/** 所有卡通用的参数(它的 skill「通用参数」节)。 */
const COMMON_PARAMS = ['theme', 'offsetX', 'offsetY', 'accent', 'scale', 'speed', 'dimAt', 'dimMode'] as const;

/**
 * 每种卡允许的专有参数 —— 来自它 skill 的卡片库表。「不要臆造字段」是它的
 * 硬规则, 模型编出表外字段时在这里就拦下(带着字段名与所属卡), 不等到 Studio
 * 里静默不生效让用户以为参数坏了。
 */
export const KIND_PARAMS: Record<OverlayKind, readonly string[]> = {
  'chapter-bar': ['chapters', 'showProgress'],
  'pin-board': ['position', 'title', 'subtitle', 'items', 'stepMs'],
  'caption-track': ['lines', 'showEn'],
  'stat-proof': ['kicker', 'kickerZh', 'value', 'prefix', 'suffix', 'footEn', 'footZh', 'countMs', 'position'],
  'ring-metric': ['kicker', 'value', 'max', 'unit', 'label', 'position'],
  odometer: ['kicker', 'value', 'unit', 'label', 'position'],
  'rank-bars': ['title', 'rows', 'suffix', 'position'],
  'growth-curve': ['kicker', 'kickerZh', 'points', 'unit', 'drawMs', 'caption', 'position'],
  'versus-card': ['aKicker', 'aTitle', 'aSub', 'bKicker', 'bTitle', 'bSub', 'winner'],
  'quote-lockup': ['quote', 'author', 'side'],
  'punch-pill': ['text', 'position'],
  'step-timeline': ['title', 'steps', 'revealed', 'position'],
  checklist: ['title', 'items', 'checked', 'stepMs', 'position'],
  'term-card': ['en', 'term', 'def', 'position'],
  'ui-callout': ['label', 'ringW', 'ringH', 'side'],
  'blur-text': ['text', 'staggerMs', 'position'],
  'type-shift': ['lines', 'shiftAtMs', 'position'],
  'entity-chips': ['chips', 'note', 'stepMs', 'position'],
  'focus-card': ['bg', 'side', 'items', 'stepMs', 'showRing', 'camSrc'],
  'terminal-3d': ['file', 'lines', 'cps', 'position'],
};

/**
 * 列表型参数的分隔符归一(真机首跑就撞上): Studio 的格式是「分隔符字符串」
 * (items: "a|b|c"、chips 一行一块), 模型天然爱写数组 —— 这是**机械可转换**的
 * 偏差, 确定性归一掉, 不烧修复轮次(与 shot-plan 的 stripLegacyConnector 同类)。
 * 分隔符按 (kind, 参数名) 定: chips 与 caption-track 的 lines 用换行, 其余用竖线。
 */
function joinSepFor(kind: string, param: string): string {
  if (param === 'chips') return '\n';
  if (kind === 'caption-track' && param === 'lines') return '\n';
  return '|';
}

const normalizeCardParams = (v: unknown): unknown => {
  if (!v || typeof v !== 'object') return v;
  const card = v as { kind?: unknown; params?: unknown };
  if (!card.params || typeof card.params !== 'object') return v;
  const params = { ...(card.params as Record<string, unknown>) };
  for (const [key, val] of Object.entries(params)) {
    if (Array.isArray(val) && val.every((x) => ['string', 'number'].includes(typeof x))) {
      params[key] = val.map(String).join(joinSepFor(String(card.kind), key));
    }
  }
  return { ...(v as Record<string, unknown>), params };
};

const CardSchema = z.preprocess(normalizeCardParams, z.object({
  id: z.string().min(1),
  kind: z.enum(OVERLAY_KINDS),
  start: z.number().min(0),
  end: z.number().positive(),
  seg: z.string().optional(),
  lintOff: z.union([z.literal(true), z.array(z.string())]).optional(),
  params: z.record(z.unknown()),
}).strict().superRefine((card, ctx) => {
  // 参数值必须是标量 —— 归一化只救得了标量数组, 嵌套对象这类要模型自己改,
  // 报错必须带实际值(「Invalid input」式的盲修报错在真机上两轮救不回来)。
  for (const [key, val] of Object.entries(card.params)) {
    if (!['string', 'number', 'boolean'].includes(typeof val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `「${card.id}」(${card.kind}) 的 params.${key} 是 ${JSON.stringify(val)?.slice(0, 120)}`
          + ` —— 参数值只能是字符串/数字/布尔; 列表内容写成分隔符字符串(如 "a|b|c")。`,
        path: ['params', key],
      });
    }
  }
  if (card.end <= card.start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `「${card.id}」(${card.kind}) 的 end=${card.end} 不晚于 start=${card.start} —— 结束必须晚于开始。`,
      path: ['end'],
    });
  }
  const allowed = new Set<string>([...COMMON_PARAMS, ...KIND_PARAMS[card.kind]]);
  for (const key of Object.keys(card.params)) {
    if (!allowed.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `「${card.id}」(${card.kind}) 的 params 里有卡片库不认识的字段「${key}」`
          + ` —— 该卡只支持: ${KIND_PARAMS[card.kind].join(', ')}(外加通用参数)。删掉它或换正确的字段名, 不要发明字段。`,
        path: ['params', key],
      });
    }
  }
}));

export const OverlayArrangementSchema = z.object({
  version: z.literal(1),
  theme: z.enum(['dark', 'light']),
  cards: z.array(CardSchema).min(1),
}).strict().superRefine((doc, ctx) => {
  const seen = new Map<string, number>();
  doc.cards.forEach((c, i) => {
    const prev = seen.get(c.id);
    if (prev !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `卡片 id「${c.id}」重复出现(第 ${prev + 1} 张与第 ${i + 1} 张) —— id 必须唯一, 按 card-1、card-2… 递增。`,
        path: ['cards', i, 'id'],
      });
    }
    seen.set(c.id, i);
  });
});

export type OverlayArrangement = z.infer<typeof OverlayArrangementSchema>;

/** zod issue → 修复循环可用的一句话(与 film-plan-builder 的 describeZodIssues 同一纪律)。 */
export function describeArrangementIssues(raw: unknown): string[] {
  const r = OverlayArrangementSchema.safeParse(raw);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const path = i.path.join('.');
    return path ? `${path}: ${i.message}` : i.message;
  });
}
