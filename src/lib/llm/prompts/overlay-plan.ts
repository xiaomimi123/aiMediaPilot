import { z } from 'zod';
import { OVERLAY_KINDS, OVERLAY_SLOTS } from '@/lib/video-production/overlay-plan';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 口播文字叠加计划(二十三期)。
 *
 * 参考片拆解见 `docs/superpowers/specs/2026-08-29-talking-head-overlay-style.md`。
 *
 * 这个 prompt 和「导演」是两件完全不同的活儿:
 * - 导演: 把话切成镜头, 每镜配一段要生成的画面
 * - 这里: **一句话都不切**, 只决定「哪几个词值得在屏幕上立起来, 什么时候立、立在哪」
 *
 * 最容易出错的地方是模型会把字幕再抄一遍当关键词 —— 那样屏幕上同一句话出现两次,
 * 而且大的那份还盖住脸。所以 prompt 里这条要写死。
 */

const ItemSchema = z.object({
  kind: z.enum(OVERLAY_KINDS),
  /** 关键词要短。长了就不是"立起来的词", 是第二份字幕。 */
  text: z.string().max(14),
  slot: z.enum(OVERLAY_SLOTS),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
});

export const OverlayPlanResponseSchema = z.object({
  items: z.array(ItemSchema).min(1).max(40),
});

export type OverlayPlanResponse = z.infer<typeof OverlayPlanResponseSchema>;

function buildSystemPrompt(): string {
  return `你在给一条**真人口播视频**做文字叠加。全片不切镜、没有 B-roll —— 观众从头到尾看着这个人说话, 节奏完全靠屏幕上的文字做出来。

你的活儿只有一件: **挑出值得在屏幕上立起来的那几个词, 决定它们什么时候出现、出现在哪一格。**

## 三种元素

- \`keyword\` 蓝色大字。整条片子的骨架, 一屏最多 3 个。**2~8 个字**, 是名词或短判断("用内容""勾住需求""付费原因"), 不是句子。
- \`note\` 白色中字。给关键词加限定("解决什么需求""吸引什么样的粉丝")。**不超过 12 字**。
- \`arrow\` 箭头。text 留空即可(默认 ↓)。只在两个上下相邻的关键词之间用, 用来表示"推导出"。

## 位置

左侧五格 \`left-1\`~\`left-5\` 自上而下, 是安全区(拍摄时人在画面右半边)。
\`top-center\` / \`bottom-center\` 谨慎用 —— 底部会和字幕打架。

**竖向堆叠是主形态**: 一个论证过程就是 left-1 关键词 → left-2 箭头 → left-3 关键词 → left-4 箭头 → left-5 结论。

## 硬规则

1. **绝不把字幕原句抄成关键词。** 观众已经在读字幕了, 大字再抄一遍等于同一句话出现两次, 而且大的那份还盖住脸。关键词必须是**从这句话里提炼出来的那个词**。
2. **一屏同时最多 3 个元素**(箭头也算)。堆满五格的时候整屏都是字, 人就没了。
3. **同一格的两条不许时间重叠** —— 会叠在一起糊成一团。
4. 关键词该**停留到这一小段讲完**, 不是说到那个词才闪一下。观众要能回看它。
5. 讲纯过渡、纯铺垫的句子就**不要叠字**。全程有字等于全程没重点。

## 时间

用给你的转写时间轴。关键词的 startMs 对齐它被说到的那一句的开始, endMs 到这一小段结束。

只输出 JSON, 不要 markdown 代码块, 不要解释文字。`;
}

function buildUserMessage(input: {
  /** 带时间戳的转写。 */
  segments: { startMs: number; endMs: number; text: string }[];
  durationMs: number;
}): ContentPart[] {
  const lines = input.segments
    .map((s) => `[${s.startMs}~${s.endMs}] ${s.text}`)
    .join('\n');

  return [
    {
      type: 'text',
      text: `全片 ${Math.round(input.durationMs / 1000)} 秒。转写(毫秒时间轴):\n\n${lines}\n\n给出叠加计划。记住: 关键词是从话里提炼的词, 不是把话抄一遍。`,
    },
  ];
}

export const OVERLAY_PLAN = {
  buildSystemPrompt,
  buildUserMessage,
  responseSchema: OverlayPlanResponseSchema,
};

/**
 * 清洗模型输出。
 *
 * 模型会犯的几类错在 schema 层拦不住, 只能在这里收:
 * 1. 同一格时间重叠 —— 两条叠在一起糊成一团
 * 2. 关键词抄了整句 —— schema 只能限长度, 限不住"这就是那句话"
 * 3. 时间超出片长 —— 烧出来是永远不出现的鬼影
 *
 * 丢掉而不是修正: 一条被丢掉的叠加只是少一个字, 而一条被"修正"到错误时间的
 * 叠加会出现在不该出现的地方, 更难发现。
 */
export function sanitizeOverlayItems<T extends { kind: string; text: string; slot: string; startMs: number; endMs: number }>(
  items: T[],
  durationMs: number,
  captionTexts: string[] = [],
): T[] {
  const captions = new Set(captionTexts.map((t) => t.replace(/[\s，。、；：！？,.;:!?]/g, '')));
  const bySlot = new Map<string, { startMs: number; endMs: number }[]>();
  const out: T[] = [];

  for (const it of [...items].sort((a, b) => a.startMs - b.startMs)) {
    if (it.endMs <= it.startMs) continue;
    if (it.startMs >= durationMs) continue;
    const endMs = Math.min(it.endMs, durationMs);

    // 关键词/说明抄了整句字幕的直接丢
    const bare = it.text.replace(/[\s，。、；：！？,.;:!?]/g, '');
    if (it.kind !== 'arrow' && bare.length > 0 && captions.has(bare)) continue;

    const used = bySlot.get(it.slot) ?? [];
    if (used.some((u) => it.startMs < u.endMs && endMs > u.startMs)) continue;
    used.push({ startMs: it.startMs, endMs });
    bySlot.set(it.slot, used);

    out.push({ ...it, endMs });
  }

  return out;
}
