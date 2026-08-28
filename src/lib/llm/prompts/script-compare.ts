import { z } from 'zod';
import { ACT_KEYS } from '@/lib/script/six-act';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 对照版(二十三期)。
 *
 * **为什么最初没做, 又为什么现在做。**
 *
 * 最初只做逐句诊断, 理由是「AI 润色过的句子, AI 也会写给别人」。用户的反驳是对的:
 * 只给病名不给病例, 等于一张空白答卷 —— 知道「这句啰嗦」和知道「不啰嗦长什么样」
 * 之间隔着的正是学习本身。看不到对照, 诊断就只是指责。
 *
 * 所以做, 但守住一件事: **对照版永远是对照, 不会悄悄变成他的稿子**。
 * - 它单独存在 `output.compareVersions`, 不碰 `script.acts`
 * - 前端并排显示, 不提供「一键采用」
 * - 他要是照抄了, 「改写」页签会算出重合度并说出来 —— 不拦, 但不装作没发生
 *
 * 这条线的意义: 改写度量的是「这稿子还有多少不是他的」。如果对照版能悄悄流进正文
 * 而指标毫无反应, 那个数字就开始骗人了, 整套评估也就没用了。
 *
 * 教的东西在 `whatChanged` 里, 不在改写后的句子里。同一段素材换个写法看一遍, 学到
 * 的是手法; 只拿到一段更好的文字, 学到的是这段文字。
 */

const CompareActSchema = z.object({
  act: z.enum(ACT_KEYS),
  /** 同一件事换一种写法。 */
  rewritten: z.string().max(300),
  /** 这一幕动了什么手法 —— 对照版本身不教人, 这句话才教人。 */
  whatChanged: z.string().min(2).max(60),
  /**
   * 这一幕本来就写得对, 不给替代写法。
   *
   * 必填, 因为前端要换一种呈现。**没有这个字段时模型会硬凑**: 真机上它对写得好的
   * 三幕给出「原文保留, 场景感强, 无需改动」—— 那是评价不是手法, 学不到东西, 而
   * 「把『那种感觉』改成『那感觉』」这种改词更糟, 它让人以为进步就是抠字。
   */
  keep: z.boolean(),
});

export const ScriptCompareResponseSchema = z.object({
  acts: z.array(CompareActSchema).min(1).max(ACT_KEYS.length),
  /** 整稿最主要的一个差别, 一句话。 */
  overallNote: z.string().min(2).max(120),
});

export type ScriptCompareResponse = z.infer<typeof ScriptCompareResponseSchema>;

function buildSystemPrompt(): string {
  return `使用者写好了一支口播视频的六幕稿。给他一份**对照版**: 同样的内容、同样的
素材, 换一种写法, 让他能看出差别在哪。

## 这是对照, 不是代笔

他不会直接用你的版本 —— 他要看的是「同一件事还能怎么写」。所以:

- **每一幕都要写 whatChanged**: 这一幕你动了什么手法(结论前置 / 删掉铺垫 /
  把抽象换成动作 / 拆成两个短句 / 把结果放到前面)。**这句话才是他真正要的东西**,
  改写后的句子只是它的例子。
- whatChanged 说手法, 不要说「更流畅了」「更有吸引力」这种评价 —— 那不能学。

## 换写法, 不是改词

对照的价值在于让他看见**另一个选择**: 同样这段素材, 换一个切入顺序、换一个开口
方式、把哪一句放到最前面、把结论提到前头、把铺垫整段删掉。

**硬规则: 如果你想做的改动只是换一个词、加减一两个字、或者动一个标点,**
**那就把 keep 设成 true, 什么都不要改。**

下面这些都是不合格的对照, 一条都不许出现:

  ✗ 「卖了六千多单」→「卖出去六千多单」(多一个字)
  ✗ 「我没卖课，也没收徒」→「我没卖课也没收徒」(删一个逗号)
  ✗ 「那种感觉」→「那感觉」(换个词)
  ✗ 「不是一个人」→「不是我一个」(换个说法)

合格的对照长这样:

  ✓ 把三句里的后两句对调, 让这一幕收在结果上而不是收在解释上
  ✓ 删掉开头那句铺垫, 直接从判断开口
  ✓ 把结论从最后提到最前, 后面全部变成论据

判断标准很简单: **这个改动能不能写成一条他下次写别的稿子也用得上的规则?**
能, 就给对照; 不能, 就 keep。抠字眼学不到任何下次能用的东西。

## 别动他的语气

他说「这个东西」你不要改成「这鬼东西」, 他说「所有想用的普通人」你不要改成
「每个想用的普通人」。语气和用词的分寸是他的, 你换的是结构。

## 这一幕丢了分的话, 对照要冲着那几条去

每一幕后面如果标了「丢分」, 那是系统按评分标准算出来的、这一幕实际扣掉的分。
**标了丢分的幕不许设 keep**, 你的对照必须真的解决它, 并在 whatChanged 里说清楚
解决的是哪一条。

用户的原话是: 既然有评分标准, 为什么不给我一份照着它能拿满分的写法。他是对的 ——
一边说「你丢了 14 分」一边说「这一幕不用改」, 那是自相矛盾。

  丢分「念下来 6.8 秒，超出目标 0.8 秒」→ 对照就要真的短下来, 不是换个说法
  丢分「有垫话「这个东西」」→ 对照里那个词必须不见了
  丢分「结尾只对同行成立」→ 对照要把结论扩到别的行当也成立

## 这一幕本来就写得对时

**没有标丢分**的幕才可以 keep。不要硬凑: 把 keep 设成 true, rewritten 原样返回
他的句子, 然后在 whatChanged 里说清楚**它为什么成立**——用手法讲(「先给具体动作
再给判断, 所以不空」), 不要写「写得很好」「很有冲击力」那种话, 那和评价一样不能学。

知道自己哪句写对了、对在哪, 和知道哪句要改一样重要。

## 不许编他没说过的事

**只能用他原文里已经有的素材。** 不许加数字、加案例、加他没提过的经历。

  ✓ 他说「更了两个月，最好的一条三千播放」→ 你可以把这两件事换个顺序说
  ✗ 他没说涨了多少粉 → 你写「涨了 5000 粉」

编出来的细节是最坏的一种: 它看起来像是「写得更好了」, 但那是因为你替他多说了一件
他没有的事。他照着学, 学到的就是编。

## 不许跨幕搬内容

六幕是对着时间轴的, 每一幕有自己的秒数预算。**不要把某一幕的内容并到另一幕**,
也不要把一幕拆到两幕 —— 那不是写法, 那是改结构, 会让时长分配整个错位。
每一幕的对照只能用这一幕自己的句子。

## 手法之外, 别改他的判断

他的观点、立场、结论必须原样保留。你换的是怎么说, 不是说什么。

## 可以留空

某一幕他本来就没写, 就不要给这一幕出对照 —— 从空白里变出来的不叫对照。

${JSON_STRICTNESS}`;
}

function buildUserMessage(input: {
  acts: { act: string; narration: string }[];
  /** 每一幕按评分标准实际丢的分 —— 对照要冲着这些去, 见 system prompt。 */
  gaps?: Partial<Record<string, string[]>>;
}): ContentPart[] {
  const body = input.acts
    .filter((a) => a.narration.trim())
    .map((a) => {
      const g = input.gaps?.[a.act] ?? [];
      const tail = g.length > 0 ? `\n丢分: ${g.join('; ')}` : '';
      return `【${a.act}】\n${a.narration.trim()}${tail}`;
    })
    .join('\n\n');

  return [{ type: 'text', text: `这是我写的六幕稿:\n\n${body}` }];
}

export const SCRIPT_COMPARE = {
  buildSystemPrompt,
  buildUserMessage,
  responseSchema: ScriptCompareResponseSchema,
};

/** 去掉标点与空白。 */
function bare(text: string): string {
  return (text ?? '').replace(/[\s，。、；：！？,.;:!?—…""''「」《》()（）\n]/g, '');
}

const CN_DIGITS: Record<string, string> = {
  一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5',
  六: '6', 七: '7', 八: '8', 九: '9', 十: '10',
};

function numbersIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d+/g)) out.add(m[0]);
  for (const [cn, ar] of Object.entries(CN_DIGITS)) if (text.includes(cn)) out.add(ar);
  return [...out];
}

export interface CompareFacts {
  clean: boolean;
  /** 对照版里冒出来、原文没有的数字。 */
  inventedNumbers: string[];
}

/**
 * 对照版有没有替他多说一件事。
 *
 * 只查数字, 和标题那条同一个道理: 编出来的数字看起来最像「写得更好了」, 但那是因为
 * 多了一件他没有的事 —— 他照着学, 学到的就是编。形容词夸不夸张是风格判断, 那个交给
 * 他自己看。
 */
export function checkCompareFacts(original: string, rewritten: string): CompareFacts {
  const inSrc = new Set(numbersIn(original));
  const invented = numbersIn(rewritten).filter((n) => !inSrc.has(n));
  return { clean: invented.length === 0, inventedNumbers: invented };
}

/**
 * 字级重合度。
 *
 * **单独用它判「有没有照抄」是错的**, 别再那么用: 对照版本身就是把他的字重新排序,
 * 所以一个字没动的时候这个数也是 100%。真机上因此在页面上打出了「这段基本是 AI 的
 * 表达了」—— 反过来指责他抄了自己写的东西, 比不提示坏得多。
 *
 * 判照抄看 `looksCopiedFromCompare`。这个函数只留给 `isTooSmallToTeach` 之外的
 * 粗略比对用。
 */
export function overlapWithCompare(narration: string, compare: string): number {
  const a = bare(narration);
  const b = bare(compare);
  if (!a || !b) return 0;

  const pool = new Map<string, number>();
  for (const ch of b) pool.set(ch, (pool.get(ch) ?? 0) + 1);

  let hit = 0;
  for (const ch of a) {
    const n = pool.get(ch) ?? 0;
    if (n > 0) { hit++; pool.set(ch, n - 1); }
  }
  return hit / a.length;
}

/** 每个分句改了多少 —— 复用改写度那把尺(LCS)。 */
function clauseRatio(a: string, b: string): number {
  const x = bare(a);
  const y = bare(b);
  if (!x && !y) return 0;
  if (!x || !y) return 1;
  const m = x.length;
  const n = y.length;
  let prev = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/** 按气口切分句 —— 结构变没变看的就是这一层。 */
function clauses(text: string): string[] {
  return text.split(/[，,、；;。！？!?—…]+/).map((c) => c.trim()).filter(Boolean);
}

/** 单个分句改到这个程度以上, 就不是换词了。 */
const CLAUSE_REWRITTEN = 0.35;

/**
 * 这个「对照」小到学不到东西吗。
 *
 * **不能只靠 prompt 里那条规则。** 真机上写死了「只换一个词就设 keep」并给了四条
 * 反例之后, 六幕里仍有一幕交上来「就是 → 只是」。模型对「多大算大」没有稳定的尺,
 * 而这件事我能量 —— 能量的就不该指望它自觉。
 *
 * **单一比例阈值行不通, 试过。** 字级重合和 LCS 改写度在短句上都分不开:
 * 「卖了六千多单」→「卖出去六千多单」只插了一个字, 改写度 0.222; 而真正删掉铺垫、
 * 把结果提前的那一幕是 0.216 —— 抠字的那条反而更"大"。九个字的句子里动一个字,
 * 比例天然就高。
 *
 * 真正的分界在**分句结构**: 抠字会原样保留分句的个数和顺序, 换写法一定会挪、会删、
 * 会并。所以判的是「分句数一样, 且每个分句都只是被换了几个词」。
 *
 * 命中就整幕不显示 —— 抠字眼教给人的是「进步 = 抠字眼」, 那会把人带偏; 而这一幕
 * 又没有一句合格的「它为什么成立」可以退回去展示, 所以宁可空着。
 */
export function isTooSmallToTeach(original: string, rewritten: string): boolean {
  if (!bare(original) || !bare(rewritten)) return false;

  const a = clauses(original);
  const b = clauses(rewritten);
  if (a.length !== b.length) return false;

  return a.every((clause, i) => clauseRatio(clause, b[i]) < CLAUSE_REWRITTEN);
}

/**
 * 他把对照版抄进正文了吗。
 *
 * **必须拿出对照时的原文当参照**, 光比「现在的正文 vs 对照版」一定会误判: 对照版是
 * 他的字重排出来的, 字级重合天然接近 100%, 而 LCS 也高 —— 真机上就这么冤枉过他一次。
 *
 * 所以判两件事:
 * 1. 正文根本没动过 → 不可能是抄的, 直接 false
 * 2. 动过了, 那就看它现在离对照版有多近 —— 近到几乎一字不差才算抄
 *
 * 为什么要判: 不是为了拦他。改写度那个数字声称「这稿子还有多少是你的」, 对照版
 * 悄悄流进正文而指标毫无反应的话, 那个数字就开始骗人 —— 骗人的指标比没有更坏。
 */
export function looksCopiedFromCompare(input: {
  narration: string;
  compare: string;
  /** 出对照那一刻他的正文。 */
  original: string;
}): boolean {
  const now = bare(input.narration);
  const ai = bare(input.compare);
  const was = bare(input.original);
  if (!now || !ai) return false;

  // 一个字没动 —— 那就是他自己的稿子, 不是抄来的
  if (now === was) return false;

  // 动过了: 只有近到几乎一字不差才算抄
  return clauseRatio(now, ai) < 0.1;
}
