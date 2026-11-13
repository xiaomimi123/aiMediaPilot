/**
 * 热点分。只读已经入库的字段，缺的项不编，权重让给其余项。
 * 改权重、封顶、半衰期、赛道词，只改下面这个 HOT_SCORE。
 *
 * 热度（各源自己的刻度，对数后封顶 100）：
 * - GitHub：当前 star 数。抓取会覆盖旧值，没有上一次的数，不算增速。
 * - Hacker News：points。评论数没有入库。
 * - X：库里只有一个整数。抓取时优先记浏览，没有浏览才记点赞，没有分开存。
 * - 对标：digg / 平时中位数。没有基线就是没有这项。
 * 新旧：抓取日或发布时间，半衰期 3 天。
 * 赛道：标题和简介是否碰到 AI、搞钱、工具。账号定位里的内容支柱名称一并算；没填就不加词。
 * 亲测：是不是 GitHub 仓库（这条流水线能录操作）。不是仓库就记 0，不是缺字段。
 */

export const HOT_SCORE = {
  weights: { heat: 0.45, recency: 0.25, fit: 0.2, handsOn: 0.1 },
  halfLifeDays: 3,
  caps: { github: 100_000, hackernews: 500, x: 100_000, benchmark: 10 },
  track: {
    ai: ['ai', 'agent', 'llm', 'gpt', '模型', '智能体', '大模型', 'claude', 'openai', 'deepseek', '机器学习'],
    money: ['搞钱', '变现', '赚钱', '收入', '副业', '定价', '价格', '付费', '商业', 'saas'],
    tools: ['工具', 'tool', '开源', 'github', 'cli', 'api', '自动化', 'workflow', '脚本', '爬虫', 'agent'],
  },
} as const;

export type ScoreKey = 'heat' | 'recency' | 'fit' | 'handsOn';

export interface ScorePart {
  key: ScoreKey;
  label: string;
  /** 0–100。null 表示这个字段不存在，不参与合计。 */
  value: number | null;
  /** HOT_SCORE 里的原始权重 */
  weight: number;
  /** 缺项被拿掉之后，这一项实际占的比例。value 为 null 时是 0。 */
  applied: number;
  detail: string;
}

export interface HotScore {
  total: number;
  parts: ScorePart[];
}

export interface ScoreInput {
  provider: string;
  title: string;
  summary: string | null;
  url: string | null;
  /** null：没有这个字段。0：字段在，值是 0。 */
  heat: number | null;
  /** 抓取日 YYYY-MM-DD，或发布时间的 ISO 字符串 */
  seenAt: string | null;
}

export interface ScoreContext {
  /** 账号定位里的内容支柱。空数组表示没填，不算额外命中。 */
  extraTerms: string[];
}

const LABELS: Record<ScoreKey, string> = { heat: '热度', recency: '新旧', fit: '赛道', handsOn: '亲测' };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 本地日历日的零点。YYYY-MM-DD 按本地时区，ISO 字符串按它自己的时刻。 */
export function seenTime(seenAt: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(seenAt);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const t = Date.parse(seenAt);
  return Number.isNaN(t) ? NaN : t;
}

export function ageDays(seenAt: string, now: Date): number {
  const t = seenTime(seenAt);
  if (Number.isNaN(t)) return NaN;
  return (now.getTime() - t) / 86_400_000;
}

function logScore(heat: number, cap: number): number {
  if (heat <= 0 || cap <= 0) return 0;
  return clamp((Math.log10(1 + heat) / Math.log10(1 + cap)) * 100, 0, 100);
}

function heatCap(provider: string): number | null {
  if (provider === 'github') return HOT_SCORE.caps.github;
  if (provider === 'hackernews') return HOT_SCORE.caps.hackernews;
  if (provider === 'x') return HOT_SCORE.caps.x;
  if (provider === 'benchmark') return HOT_SCORE.caps.benchmark;
  return null;
}

function heatDetail(input: ScoreInput, cap: number | null): string {
  if (input.heat == null || cap == null) return '没有能用的热度字段，这一项不计入。';
  const n = input.heat.toLocaleString('en-US');
  const top = cap.toLocaleString('en-US');
  if (input.provider === 'github') return `当前 ${n} stars，按 ${top} 封顶取对数。库里没有上一次的 star，不算增速。`;
  if (input.provider === 'hackernews') return `${n} points，按 ${top} 封顶取对数。评论数没有入库。`;
  if (input.provider === 'x') return `库里只有一个整数 ${n}。抓取时优先记浏览，没有浏览才记点赞，没有分开存，也不算增速。按 ${top} 封顶取对数。`;
  if (input.provider === 'benchmark') return `平时的 ${n} 倍，按 ${top} 倍封顶。点赞、评论、转发没有再合成一项。`;
  return '这个来源没有热度刻度，这一项不计入。';
}

const GROUP_NAME = { ai: 'AI', money: '搞钱', tools: '工具', account: '账号定位' } as const;

function termHit(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  if (/[a-z0-9]/i.test(t)) {
    const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    return re.test(text);
  }
  return text.toLowerCase().includes(t.toLowerCase());
}

function fitOf(input: ScoreInput, extraTerms: string[]): { value: number; detail: string } {
  const text = `${input.title}\n${input.summary ?? ''}`;
  const groups = (['ai', 'money', 'tools'] as const).filter((g) => HOT_SCORE.track[g].some((term) => termHit(text, term)));
  const account = extraTerms.some((term) => termHit(text, term));
  const names = [...groups.map((g) => GROUP_NAME[g]), ...(account ? [GROUP_NAME.account] : [])];
  const aiSide = groups.includes('ai') || account;
  const toolSide = groups.includes('money') || groups.includes('tools') || account;
  const value = names.length === 0 ? 0 : aiSide && toolSide ? 100 : 60;
  const base = extraTerms.length ? '赛道词是 AI、搞钱、工具，再加上账号定位里的内容支柱。' : '赛道词是 AI、搞钱、工具。账号定位没填，没有额外词。';
  const detail = names.length ? `命中${names.join('、')}。${base}` : `标题和简介都没碰到。${base}`;
  return { value, detail };
}

function handsOn(input: ScoreInput): { value: number; detail: string } {
  if (input.provider === 'github') return { value: 100, detail: 'GitHub 仓库，可以录操作做成亲测。' };
  if (input.url && /github\.com\//i.test(input.url)) return { value: 70, detail: '链接指向 GitHub 仓库，可以录操作。' };
  return { value: 0, detail: '不是仓库，不做亲测录屏。这项记 0。' };
}

export function scoreHot(input: ScoreInput, now: Date, ctx: ScoreContext = { extraTerms: [] }): HotScore {
  const cap = heatCap(input.provider);
  const heatValue = input.heat == null || cap == null ? null : Math.round(logScore(input.heat, cap) * 10) / 10;
  let recencyValue: number | null = null;
  let recencyDetail = '没有抓取日或发布时间，这一项不计入。';
  if (input.seenAt) {
    const age = ageDays(input.seenAt, now);
    if (!Number.isNaN(age)) {
      recencyValue = Math.round(100 * Math.exp((-Math.LN2 * Math.max(0, age)) / HOT_SCORE.halfLifeDays) * 10) / 10;
      recencyDetail = `距今 ${Math.max(0, age).toFixed(1)} 天，半衰期 ${HOT_SCORE.halfLifeDays} 天。`;
    }
  }
  const fit = fitOf(input, ctx.extraTerms);
  const hands = handsOn(input);
  const raw: { key: ScoreKey; value: number | null; detail: string }[] = [
    { key: 'heat', value: heatValue, detail: heatDetail(input, cap) },
    { key: 'recency', value: recencyValue, detail: recencyDetail },
    { key: 'fit', value: fit.value, detail: fit.detail },
    { key: 'handsOn', value: hands.value, detail: hands.detail },
  ];
  const present = raw.reduce((s, p) => (p.value == null ? s : s + HOT_SCORE.weights[p.key]), 0);
  const parts: ScorePart[] = raw.map((p) => {
    const weight = HOT_SCORE.weights[p.key];
    return { key: p.key, label: LABELS[p.key], value: p.value, weight, applied: p.value == null || present === 0 ? 0 : weight / present, detail: p.detail };
  });
  const sum = parts.reduce((s, p) => s + (p.value ?? 0) * p.applied, 0);
  return { total: Math.round(sum), parts };
}
