/**
 * 口播稿评分体系 —— 硬指标层(二十二期)。
 *
 * 动因: 稿子改到第五版时才发现「信任声明被删掉了」这种结构性退步 —— 肉眼逐版对比
 * 是发现不了的。评分把「这一版比上一版好在哪、差在哪」变成可比较的数字。
 *
 * 分层原因: 语速、垫话、合规词这类**能量的**指标用纯函数即时算, 免费且每次结果一样;
 * 钩子力度、金句质量这类**要判断的**交给 LLM(见 script-score-prompt.ts)。
 * 不把能算的也丢给模型 —— 模型算字数会算错, 而且同一稿两次跑分数会飘。
 *
 * 评分标准来自用户拆解的两条真实爆款(奥一「三天AI赚5000」3512赞、王飞雨「skill卖到70个」
 * 2277赞), 不是凭空定的:
 * 3-资源/wiki/小红书/奥一-三天AI赚5000-视频拆解.md
 * 3-资源/wiki/小红书/王飞雨-skill卖到70个-视频拆解.md
 */

/** 评分只读这几个字段, 不依赖完整 ScriptAct —— 便于测试和跨形状复用。 */
export interface ScorableAct {
  act: string;
  narration: string;
  visual?: string;
}

export interface ScoreDimension {
  key: string;
  label: string;
  score: number;
  max: number;
  /** 扣分理由, 直接展示给用户 —— 只给分不说为什么等于没评。 */
  reason: string;
}

export interface HardScoreResult {
  dimensions: ScoreDimension[];
  total: number;
  max: number;
}

const MAX_TRUST = 10;
const MAX_COMPLIANCE = 5;
const MAX_UNIVERSAL = 5;
const MAX_CONCISE = 15;

export const HARD_MAX = MAX_TRUST + MAX_COMPLIANCE + MAX_UNIVERSAL + MAX_CONCISE;

/** 「先说清楚我不卖课」这类防喷声明。奥一在第 13 秒就放了这句。 */
const TRUST_PATTERNS = [
  /不卖课/,
  /不带货/,
  /不收徒/,
  /不收费/,
  /不收钱/,
  /不恰饭/,
  /不引流/,
];

/**
 * 会被平台判成「展示收益诱导」的画面元素。
 * 注意: 用户的约束是「**可以提数据, 不可以展示数据**」—— 所以只查 visual(画面),
 * 不查 narration(口播)。口播里说「卖了六千多单」是允许的。
 */
const COMPLIANCE_RISK = [/后台/, /收款/, /订单/, /流水/, /收益/, /提现/, /banner/i];
/** 风险词必须和「展示」类词同现才算违规 —— 光提到「后台」不代表要拍它。 */
const COMPLIANCE_SHOW = [/截图/, /展示/, /放/, /切到/, /露出/, /出现/, /特写/, /录屏/];
/** 分句里出现否定词就豁免 —— 「全片不出现任何后台截图」是守规矩, 不是违规。 */
const NEGATION = [/不/, /别/, /勿/, /禁止/, /避免/, /杜绝/, /绝不/];

/** 结尾扩圈句式: 把受众从本赛道扩到所有人。奥一的「其他赛道逻辑也是互通的」。 */
const UNIVERSAL_PATTERNS = [
  /也是一样/,
  /同样(的道理|适用)/,
  /逻辑.{0,4}互通/,
  /换(个|到别的)?(赛道|行业|领域)/,
  /其他(赛道|行业|领域)/,
  /放到.{0,6}也(成立|适用|一样)/,
];

/**
 * 口播垫话 —— 念出来是废字, 写出来看不出来。每命中一次扣分。
 *
 * 用正则而不是裸字符串: **中文没有词边界**, 「的话」会命中「养小龙虾的话题」,
 * 「其实」会命中「与其实际」。踩过一次, 真稿子上直接误报。
 */
export const FILLER_PATTERNS: { word: string; pattern: RegExp }[] = [
  { word: '说实话', pattern: /说实话/g },
  { word: '坦白讲', pattern: /坦白(讲|说)/g },
  { word: '不得不说', pattern: /不得不说/g },
  { word: '众所周知', pattern: /众所周知/g },
  { word: '毫无意外', pattern: /毫无意外/g },
  { word: '毫无疑问', pattern: /毫无疑问/g },
  { word: '其实', pattern: /(?<!与)其实(?!际)/g },
  { word: '居然', pattern: /居然/g },
  { word: '相信大家都', pattern: /相信大家都/g },
  { word: '大家都知道', pattern: /大家都知道/g },
  { word: '值得一提的是', pattern: /值得一提的是/g },
  { word: '的话', pattern: /的话(?!题)/g },
  { word: '这个东西', pattern: /这个东西/g },
  { word: '总的来说', pattern: /总的来说/g },
];

const FILLER_PENALTY = 2;
/**
 * 一口气最多说这么多字。
 *
 * 按**逗号**切而不是句号: 口播真正的换气点是逗号。「今年很火的那个开源项目，我靠给
 * 别人安装它，赚到了第一笔钱」整句 30 多字, 但每个气口都很短, 念起来一点不憋 ——
 * 按句号判会把这种正常写法误判成长句。
 */
const LONG_BREATH_CHARS = 20;
const LONG_SENTENCE_PENALTY = 3;

/** 按所有停顿切成「气口」—— 逗号也是换气点, 长度判定按气口而不是整句。 */
function splitBreaths(text: string): string[] {
  return (text ?? '')
    .split(/[，。、；：！？,.;:!?—\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 按标点切成分句 —— 合规判定要逐个分句看否定词, 整句看会误判。
 *
 * **顿号不断句**: 「全片不出现任何后台、收款、订单截图」是一个否定管三个并列宾语,
 * 按顿号切开会让「订单截图」失去前面的「不」, 把最守规矩的写法判成违规。
 */
function splitClauses(text: string): string[] {
  return (text ?? '')
    .split(/[，。；：！？,.;:!?\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countChars(text: string): number {
  return (text ?? '').replace(/[，。：；？！、—\s]/g, '').length;
}

function scoreTrust(acts: ScorableAct[]): ScoreDimension {
  const hitIndex = acts.findIndex((a) => TRUST_PATTERNS.some((p) => p.test(a.narration ?? '')));
  const base = { key: 'trust', label: '信任声明', max: MAX_TRUST };

  if (hitIndex < 0) {
    return {
      ...base,
      score: 0,
      reason: '全片没有「不卖课/不带货」这类声明。讲赚钱又不提前打预防针, 评论区防不住。',
    };
  }
  if (hitIndex >= 2) {
    return {
      ...base,
      score: 5,
      reason: `声明出现在第 ${hitIndex + 1} 幕, 太靠后。观众的防备在开头就起来了, 挪到前两幕。`,
    };
  }
  return { ...base, score: MAX_TRUST, reason: `第 ${hitIndex + 1} 幕就把话说清楚了, 位置对。` };
}

function scoreCompliance(acts: ScorableAct[]): ScoreDimension {
  const offenders: string[] = [];

  for (const a of acts) {
    for (const clause of splitClauses(a.visual ?? '')) {
      if (NEGATION.some((p) => p.test(clause))) continue; // 「不出现后台截图」是守规矩
      const risky = COMPLIANCE_RISK.some((p) => p.test(clause));
      const showing = COMPLIANCE_SHOW.some((p) => p.test(clause));
      if (risky && showing) {
        offenders.push(`${a.act}(${clause})`);
        break;
      }
    }
  }

  if (offenders.length === 0) {
    return {
      key: 'compliance',
      label: '平台合规',
      score: MAX_COMPLIANCE,
      max: MAX_COMPLIANCE,
      reason: '画面里没有后台/收款/订单一类的展示, 合规。',
    };
  }
  return {
    key: 'compliance',
    label: '平台合规',
    score: 0,
    max: MAX_COMPLIANCE,
    reason: `画面说明里要展示收益类内容, 涉嫌诱导: ${offenders.join('、')}。数据可以口头说, 但不能上画面。`,
  };
}

function scoreUniversal(acts: ScorableAct[]): ScoreDimension {
  const last = acts[acts.length - 1];
  const hit = last ? UNIVERSAL_PATTERNS.some((p) => p.test(last.narration ?? '')) : false;
  const base = { key: 'universal', label: '普适化结尾', max: MAX_UNIVERSAL };

  if (hit) return { ...base, score: MAX_UNIVERSAL, reason: '结尾把受众从本赛道扩出去了。' };
  return {
    ...base,
    score: 0,
    reason: '结尾只对同行成立。补一句「你做电商、做服务也是一样」, 受众能扩一大圈。',
  };
}

function scoreConcise(acts: ScorableAct[]): ScoreDimension {
  const hits: string[] = [];
  let longCount = 0;

  for (const a of acts) {
    const narration = a.narration ?? '';
    for (const { word, pattern } of FILLER_PATTERNS) {
      const n = narration.match(pattern)?.length ?? 0;
      for (let i = 0; i < n; i++) hits.push(word);
    }
    for (const breath of splitBreaths(narration)) {
      if (countChars(breath) > LONG_BREATH_CHARS) longCount += 1;
    }
  }

  const penalty = hits.length * FILLER_PENALTY + longCount * LONG_SENTENCE_PENALTY;
  const score = Math.max(0, MAX_CONCISE - penalty);

  const parts: string[] = [];
  if (hits.length > 0) {
    const uniq = Array.from(new Set(hits));
    parts.push(`垫话 ${hits.length} 处: ${uniq.join('、')}`);
  }
  if (longCount > 0) {
    parts.push(`${longCount} 处一句话说太长(超过 ${LONG_BREATH_CHARS} 字没有停顿), 口播念不动`);
  }

  return {
    key: 'concise',
    label: '简洁度',
    score,
    max: MAX_CONCISE,
    reason: parts.length > 0 ? parts.join('; ') : '没有垫话, 句子都在一口气之内。',
  };
}

/**
 * 硬指标评分。纯函数, 不调网络 —— 页面每次渲染都能重算, 不需要缓存。
 */
export function scoreHardDimensions(acts: ScorableAct[]): HardScoreResult {
  const dimensions = [
    scoreConcise(acts),
    scoreTrust(acts),
    scoreUniversal(acts),
    scoreCompliance(acts),
  ];
  return {
    dimensions,
    total: dimensions.reduce((s, d) => s + d.score, 0),
    max: HARD_MAX,
  };
}

/* ---------------- 从草稿里取六幕 ---------------- */

export interface ScorableActFull extends ScorableAct {
  title: string;
  targetSec: number;
}

/**
 * 从 ScriptDraft.output 里取六幕。
 *
 * 旧的 sections 结构返回 null 而不是硬凑 —— 评分标准是按六幕定的, 对着别的结构打分
 * 只会给出误导人的数字。调用方据此提示"先转成六幕", 而不是展示一个假分数。
 */
export function readActsFromDraftOutput(output: unknown): ScorableActFull[] | null {
  const acts = (output as { script?: { acts?: unknown } } | null)?.script?.acts;
  if (!Array.isArray(acts) || acts.length === 0) return null;
  const rows = acts.map((a) => {
    const o = (a ?? {}) as Record<string, unknown>;
    return {
      act: String(o.act ?? ''),
      title: String(o.title ?? ''),
      narration: String(o.narration ?? ''),
      visual: String(o.visual ?? ''),
      targetSec: Number(o.targetSec ?? 0),
    };
  });
  return rows.every((r) => r.act && r.narration) ? rows : null;
}

/* ---------------- 软指标缓存 ---------------- */

/** 软指标一次要花钱调模型, 所以落库缓存。这是缓存的形状。 */
export interface CachedSoftScore {
  /** 打分时那份稿子的指纹。对不上 = 稿子改过 = 这个分数已经不作数。 */
  fingerprint: string;
  dimensions: ScoreDimension[];
  topFixes: string[];
  scoredAt: string;
}

export interface CachedSoftScoreView extends CachedSoftScore {
  stale: boolean;
}

/**
 * 稿子指纹 —— 只按**参与评分的字段**算(台词 + 画面说明)。
 *
 * 特意不含 note/targetSec/beats: 改个拍摄提示就让分数过期, 用户会烦到干脆不看分数。
 * 含 visual 是因为合规维度是按画面判的, 画面改了合规结论可能就变了。
 */
export function scriptFingerprint(acts: ScorableAct[]): string {
  const payload = acts.map((a) => `${a.act} ${a.narration ?? ''} ${a.visual ?? ''}`).join('');
  // djb2 —— 这里只要"变了能发现", 不需要抗碰撞, 不值得引依赖。
  let h = 5381;
  for (let i = 0; i < payload.length; i++) {
    h = ((h << 5) + h + payload.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function isCachedSoftScore(v: unknown): v is CachedSoftScore {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.fingerprint === 'string' &&
    Array.isArray(o.dimensions) &&
    Array.isArray(o.topFixes) &&
    typeof o.scoredAt === 'string'
  );
}

/**
 * 读软指标缓存。稿子改过时**不丢弃旧分**, 只标 stale ——
 * 直接清空的话用户改一个字就看不到任何分数, 反而不如"旧分 + 已过期"有用。
 */
export function readCachedSoft(raw: unknown, acts: ScorableAct[]): CachedSoftScoreView | null {
  if (!isCachedSoftScore(raw)) return null;
  return { ...raw, stale: raw.fingerprint !== scriptFingerprint(acts) };
}

/* ---------------- 合并 ---------------- */

export interface CombinedScore {
  dimensions: ScoreDimension[];
  total: number;
  max: number;
  /** 软指标跑过没有。没跑过时 max 只有 35, 不要拿去和 100 分比。 */
  softScored: boolean;
  /** 软指标是不是已经对不上当前稿子。 */
  softStale: boolean;
  topFixes: string[];
  scoredAt: string | null;
}

/**
 * 硬指标 + 软指标缓存 → 一张完整评分表。
 *
 * 硬指标排前面: 免费、即时、改完立刻能验证; 软指标要花钱, 放后面。
 */
export function combineScore(acts: ScorableAct[], softRaw: unknown): CombinedScore {
  const hard = scoreHardDimensions(acts);
  const soft = readCachedSoft(softRaw, acts);

  if (!soft) {
    return {
      dimensions: hard.dimensions,
      total: hard.total,
      max: hard.max,
      softScored: false,
      softStale: false,
      topFixes: [],
      scoredAt: null,
    };
  }

  const dimensions = [...hard.dimensions, ...soft.dimensions];
  return {
    dimensions,
    total: dimensions.reduce((s, d) => s + d.score, 0),
    max: dimensions.reduce((s, d) => s + d.max, 0),
    softScored: true,
    softStale: soft.stale,
    topFixes: soft.topFixes,
    scoredAt: soft.scoredAt,
  };
}
