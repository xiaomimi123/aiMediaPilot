import { z } from 'zod';
import { ACT_KEYS, ACT_LABELS, type ActKey } from '@/lib/script/six-act';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 导入自己写的稿子(二十三期)。
 *
 * 这个 prompt 做的是**切分**, 不是改写。
 *
 * 为什么划这条线: 这个工具的分工是「系统给起点 → 你自己写 → 系统做评估」,
 * 中间那段必须是人。把稿子交给 AI「完善」一遍, 出来的就是 AI 的表达了 —— 和
 * 骨架模式要避免的是同一件事, 而且会让「改写度」那个指标变成自欺欺人。
 *
 * 所以模型在这里**只能做两件事**: 把你的句子分到六幕里, 给每一幕起个小标题。
 * 一个字都不许改。prompt 里这条要写死并给反例 —— 模型的默认倾向就是顺手润色。
 */

const ActSchema = z.object({
  act: z.enum(ACT_KEYS),
  title: z.string().max(20),
  /** 原文的句子, 一字不改地搬过来。 */
  narration: z.string(),
});

export const ScriptImportResponseSchema = z.object({
  acts: z.array(ActSchema).length(ACT_KEYS.length),
  /**
   * 给这份稿子起的名字(稿库里的条目名)。
   *
   * **不是让用户先想一个再贴稿子。** 稿子已经在他手里了, 反过来逼他先填主题才能
   * 导入是把顺序搞反了 —— 真机上他就卡在这一步, 文案贴好了但不知道该填什么,
   * 于是下一步走不了。名字从稿子里来是唯一说得通的方向。
   *
   * 起名是**包装**, 和标题同一类, 不违反「一个字都不改」: 改的是他的表达, 起名
   * 是给这份表达贴个标签, 正文一个字没动。
   */
  topic: z.string().min(2).max(30),
});

export type ScriptImportResponse = z.infer<typeof ScriptImportResponseSchema>;

function buildSystemPrompt(): string {
  const acts = ACT_KEYS.map((k) => `${k}(${ACT_LABELS[k as ActKey]})`).join(' → ');

  return `使用者已经自己写好了一段口播稿。你的活儿只有一件: **把它切进六幕结构**。

六幕固定为: ${acts}

## 最重要的一条: 一个字都不许改

你只做切分和归类, 不做润色、不做改写、不做补充、不做删减。

  ✓ 把「我卡了两天。装环境、配依赖，每一步都报错。」切成两幕, 原句照搬
  ✗ 把它改成「我整整卡了两天——装环境、配依赖，每一步都在报新的错。」

这不是风格偏好。使用者要的是自己的表达: 他自己写的稿子才是他的一手体感, 而
AI 润色过的句子, AI 也会写给别人。你改一个字, 这份稿子就不再完全是他的了。

**你可以做的**:
- 决定哪几句属于哪一幕
- 给每一幕起一个小标题(这是你新写的, 不是改他的话)
- 给整份稿子起一个名字(topic, ≤ 15 字), 用来在稿库里认出它 —— 说清楚这稿子讲的
  是哪件事就行, 不用像标题那样抓眼球
- 某一幕在原文里确实没有内容时, narration 留空字符串

**你不可以做的**:
- 改任何一个字、任何一个标点
- 调整句子顺序(顺序是他的叙述节奏)
- 觉得哪句不好就删掉
- 觉得哪里缺就补一句

## 稿子里的结构标记

他的稿子里可能带着 【0-4秒】【开场钩子】 这类标记, 或者行首的序号。**那些不是台词,
不要放进 narration** —— 念出来会很怪。但它们是他自己划的段落线, **切分时照着走**:
他标了 0-4 秒是钩子, 你就把那段放进 hook。

## 切分原则

按语义转折切, 不按字数平均切。原文没有的幕就空着 —— 空幕会在评分里被指出来,
那是有用的信息; 硬凑一幕反而把问题盖住了。

${JSON_STRICTNESS}`;
}

function buildUserMessage(input: { text: string }): ContentPart[] {
  return [
    {
      type: 'text',
      text: `这是我写的稿子, 把它切进六幕。记住: 一个字都不要改。\n\n${input.text}`,
    },
  ];
}

export const SCRIPT_IMPORT = {
  buildSystemPrompt,
  buildUserMessage,
  responseSchema: ScriptImportResponseSchema,
};

/**
 * 时间戳的形状: `0-4秒` / `00:00-00:04` / `0:00~0:03` / `第3秒`。
 *
 * 单独抽出来是因为它要在三个地方用: 独占一行的、方括号里的、圆括号里的。
 */
const TIMESTAMP = /(?:第\s*)?\d{1,3}\s*[:：]?\s*\d{0,2}\s*[-–~～至到]\s*\d{1,3}\s*[:：]?\s*\d{0,2}\s*秒?|第?\s*\d{1,3}\s*秒/;

/**
 * 去掉稿子里的结构标记, 只留真正要念的字。
 *
 * **为什么必须有这一步。** 真实使用时导入失败了, 报「丢了「【」×6「0」×6「秒」×6」——
 * 用户的稿子里带着 `【0-4秒】` 这样的时间标记。模型的处理是对的(那不是台词, 不该
 * 念出来), 错的是逐字核对: 它把「扔掉标记」当成了「改你的字」, 于是每次都拒绝,
 * 而提示还叫他「把稿子拆短一点」—— 拆多短都没用, 因为根本不是长度问题。
 *
 * **删得保守, 宁可漏。** 这一层删过头比漏删危险得多: 核对靠的就是「原文」这个基准,
 * 基准被削掉一块, 模型真改了字也查不出来了。所以:
 * - `【...】` 整块删 —— 中文稿里这对括号几乎只用来做段落标签和时间标记
 * - 圆括号**只在里面是时间戳时**删。`（真的）`「（笑）」是口语的一部分, 不能碰
 * - 行首序号和独占一行的时间戳删
 */
export function stripScaffold(text: string): string {
  return (text ?? '')
    // 【0-4秒】【开场钩子】 —— 限长 20 字, 太长的多半是正文被误框进去了
    .replace(/【[^】\n]{0,20}】/g, '')
    // （0:00-0:03） / (0-4秒) —— 只删时间戳, 不碰口语里的括号
    .replace(
      new RegExp(`[（(]\\s*(?:${TIMESTAMP.source})\\s*[）)]`, 'g'),
      '',
    )
    // 独占一行的时间戳
    .replace(new RegExp(`^\\s*(?:${TIMESTAMP.source})\\s*$`, 'gm'), '')
    // 行首序号: 1. / 1、 / (1) / 一、
    .replace(/^\s*(?:[（(]?\d{1,2}[)）.、]|[一二三四五六七八九十]+、)\s*/gm, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/** 去掉标点和空白, 用来比对「模型有没有偷偷改字」。 */
function bare(text: string): string {
  return (text ?? '').replace(/[\s，。、；：！？,.;:!?—…""''「」《》()（）\n]/g, '');
}

export interface ImportFidelity {
  /** 切分后的全文和原文完全一致吗(忽略标点与空白)。 */
  faithful: boolean;
  /** 原文里有、切分结果里丢了的字数。 */
  missingChars: number;
  /** 切分结果里有、原文里没有的字数 —— 模型自己加的。 */
  addedChars: number;
  /**
   * 具体动了哪些字, 如 `丢「的」×2`。
   *
   * 只报数量的话没法判断严重程度: 丢两个逗号旁边的「了」和把一句话换掉, 数字
   * 可能一样, 但一个无所谓一个不能忍。
   */
  detail: string;
}

/**
 * 检查模型有没有真的一字未改。
 *
 * **必须查, 不能只靠 prompt 里那句话。** 模型的默认倾向就是顺手润色, 而润色过的
 * 稿子和原稿肉眼几乎看不出差别 —— 改一个连词、补一个「其实」, 人是发现不了的,
 * 但那份稿子已经不完全是他的了。
 *
 * 忽略标点: 切分时把一句话拆到两幕, 标点必然会变(句号变成幕边界), 那是切分的
 * 正常代价, 不算改字。
 */
export function checkImportFidelity(original: string, acts: { narration: string }[]): ImportFidelity {
  const src = bare(original);
  const out = bare(acts.map((a) => a.narration).join(''));

  // 逐字比对多重集: 位置可以变(顺序本不该变, 但那由另一条规则管), 字必须一样多
  const count = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1);
    return m;
  };
  const a = count(src);
  const b = count(out);

  let missing = 0;
  let added = 0;
  const lost: string[] = [];
  const gained: string[] = [];
  for (const [ch, n] of a) {
    const d = Math.max(0, n - (b.get(ch) ?? 0));
    if (d > 0) { missing += d; lost.push(`「${ch}」×${d}`); }
  }
  for (const [ch, n] of b) {
    const d = Math.max(0, n - (a.get(ch) ?? 0));
    if (d > 0) { added += d; gained.push(`「${ch}」×${d}`); }
  }

  const parts: string[] = [];
  if (lost.length) parts.push(`丢了 ${lost.slice(0, 6).join('')}`);
  if (gained.length) parts.push(`多了 ${gained.slice(0, 6).join('')}`);

  return {
    faithful: missing === 0 && added === 0,
    missingChars: missing,
    addedChars: added,
    detail: parts.join('; '),
  };
}
