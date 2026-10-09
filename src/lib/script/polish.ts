import { z } from 'zod';
import { ROLE_SHARE, SEGMENT_ROLES, type Script } from './model';
import { checkDuration, CHARS_PER_SEC, type DurationReport } from './duration';
import { repairMessage, segmentGuide, type StructuredLLM } from './write';
import { COPY_RUN } from '@/lib/benchmark/copy-check';

export const CHANGE_KINDS = ['删', '挪', '改', '错字'] as const;
export type Change = { kind: (typeof CHANGE_KINDS)[number]; what: string };

export const PolishOutSchema = z.object({
  title: z.string().min(1),
  segments: z.array(z.object({ text: z.string().min(1) })).length(SEGMENT_ROLES.length),
  changes: z.array(z.object({ kind: z.enum(CHANGE_KINDS), what: z.string().min(1) })),
  questions: z.array(z.string()),
});
type PolishOut = z.infer<typeof PolishOutSchema>;

export interface PolishResult {
  title: string;
  script: Script;
  report: DurationReport;
  changes: Change[];
  questions: string[];
  /** 润色稿里原文没有的片段(连续 12 字以上), 页面上让用户确认 */
  added: string[];
}

const SYSTEM_PROMPT = `你是抖音口播博主的编导，帮博主润色他自己写的口播稿。
规矩：
- 只用原文里的内容，不加新内容：不加新的经历、例子、数字、金句。
- 不改用户的说法和口头禅，保留他说话的味道；只删重复和啰嗦、调顺序、断句、改错字。
- 超出目标时长时删重复和啰嗦，直到不超上限；没超就少动。
- 改动必须全部列进 changes，每条一句话说清改了哪里（kind 只能是 删 / 挪 / 改 / 错字）。
- 意思不清、前后对不上、观众听不懂的术语，不要自己猜着改，写进 questions 让用户确认。
- 按 6 个故事节拍切段：钩子 → 我是谁·当时 → 遇到什么 → 怎么做的 → 结果 → 经验或悬念；原文没有对应内容的节拍，就把相邻内容分过去，不要编。
- 只输出 JSON：{"title": "视频标题", "segments": [{"text": "逐字稿"}, ...共 6 段], "changes": [{"kind": "删", "what": "…"}], "questions": ["…"]}。`;

const toScript = (o: PolishOut): Script => ({ segments: o.segments.map((s, i) => ({ id: `s${i + 1}`, role: SEGMENT_ROLES[i], text: s.text.trim() })) });

const norm = (s: string) => Array.from(s.replace(/[\s\p{P}\p{S}]/gu, ''));

/** 判断"来自原文"的最小片段长度: 删字、断句后原文的 4 字片段大多还在, 模型自己加的话几乎碰不上 */
const SOURCE_GRAM = 4;

/** 润色稿里连续 run 字以上、不来自原文的片段(去标点空白后比较) */
export function findAdded(polished: string, original: string, run = COPY_RUN): string[] {
  const t = norm(polished);
  const ref = norm(original).join('');
  const fromOriginal = new Array<boolean>(t.length).fill(false);
  for (let i = 0; i + SOURCE_GRAM <= t.length; i++) {
    if (ref.includes(t.slice(i, i + SOURCE_GRAM).join(''))) for (let j = i; j < i + SOURCE_GRAM; j++) fromOriginal[j] = true;
  }
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i <= t.length; i++) {
    if (i < t.length && !fromOriginal[i]) cur += t[i];
    else {
      if (cur.length >= run) out.push(cur);
      cur = '';
    }
  }
  return out;
}

/** 不改字, 把原文切成 6 段: 先按句切(句子太少就按逗号), 再按各节拍占比找最接近的切点 */
export function splitOriginal(text: string): Script {
  const pieces = (re: RegExp) => text.match(re)?.filter((p) => p.trim()) ?? [];
  let units = pieces(/[^。！？!?\n]+[。！？!?\n]*/g);
  if (units.length < SEGMENT_ROLES.length) units = pieces(/[^。！？!?\n，,；;]+[。！？!?\n，,；;]*/g);
  if (units.length < SEGMENT_ROLES.length) units = Array.from(text.trim());
  const cum = [0];
  for (const u of units) cum.push(cum[cum.length - 1] + u.length);
  const total = cum[cum.length - 1];
  const cuts = [0];
  let share = 0;
  for (let k = 1; k < SEGMENT_ROLES.length; k++) {
    share += ROLE_SHARE[SEGMENT_ROLES[k - 1]];
    const lo = cuts[k - 1] + 1;
    const hi = units.length - (SEGMENT_ROLES.length - k);
    let best = lo;
    for (let b = lo; b <= hi; b++) if (Math.abs(cum[b] - total * share) < Math.abs(cum[best] - total * share)) best = b;
    cuts.push(best);
  }
  cuts.push(units.length);
  return { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: units.slice(cuts[i], cuts[i + 1]).join('').trim() })) };
}

export async function polishScript(opts: { llm: StructuredLLM; text: string; targetSec: number }): Promise<PolishResult> {
  const original = opts.text.trim();
  if (!original) throw new Error('稿子是空的');
  const call = async (text: string) =>
    (await opts.llm.callStructured({ systemPrompt: SYSTEM_PROMPT, userMessage: [{ type: 'text', text }], responseSchema: PolishOutSchema })).result;

  let out: PolishOut;
  try {
    out = await call(`【原文】\n${original}\n\n【目标时长】${opts.targetSec} 秒，按口语 ${CHARS_PER_SEC} 字/秒\n\n【6 段节拍与参考字数】\n${segmentGuide(opts.targetSec)}`);
  } catch (e) {
    throw new Error('模型这次没交回能用的润色稿，原文没动。再点一次试试。', { cause: e });
  }
  let script = toScript(out);
  let report = checkDuration(script, opts.targetSec);
  const changes: Change[] = [...out.changes];
  if (!report.ok) {
    try {
      const fixed = await call(`${repairMessage(script, report, opts.targetSec)}\n\n只删原文里重复和啰嗦的话，不加新内容；这次删了什么列进 changes。`);
      script = toScript(fixed);
      report = checkDuration(script, opts.targetSec);
      changes.push(...fixed.changes);
    } catch {
      // 自修这一轮坏了: 照样给出超长的润色稿, 页面标「仍超出」
    }
  }
  return { title: out.title, script, report, changes, questions: out.questions, added: findAdded(script.segments.map((s) => s.text).join('\n'), original) };
}
