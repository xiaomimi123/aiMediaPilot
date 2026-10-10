import { z } from 'zod';
import type { IVisionLLM } from '@/lib/llm/vision';
import { SEGMENT_ROLES, ROLE_LABEL, type Script } from './model';
import { checkDuration, segmentBudgetSec, CHARS_PER_SEC, type DurationReport } from './duration';

export const MAX_REPAIR_ROUNDS = 2;

export type StructuredLLM = Pick<IVisionLLM, 'callStructured'>;

export const LlmScriptSchema = z.object({
  title: z.string().min(1),
  segments: z
    .array(z.object({ role: z.string(), text: z.string().min(1) }))
    .length(SEGMENT_ROLES.length),
});
type LlmScript = z.infer<typeof LlmScriptSchema>;

/** 角色按位置强制对齐 —— 模型偶尔会把 role 写错或写成中文, 顺序才是契约。 */
export function toScript(raw: LlmScript): Script {
  return {
    segments: raw.segments.map((s, i) => ({ id: `s${i + 1}`, role: SEGMENT_ROLES[i], text: s.text.trim() })),
  };
}

export function segmentGuide(targetSec: number): string {
  return SEGMENT_ROLES.map((role, i) => {
    const sec = segmentBudgetSec(role, targetSec);
    return `${i + 1}. ${ROLE_LABEL[role]}：约 ${sec} 秒，≈ ${Math.round(sec * CHARS_PER_SEC)} 字`;
  }).join('\n');
}

const SYSTEM_PROMPT = `你是抖音 AI 知识类口播博主的编导，负责写能直接开口念的口播逐字稿。
要求：
- 写得像博主本人在说话，不像文章。句子长短不齐，允许口语和语气词。
- 先交代「我是谁、我当时在干嘛」，再讲事。
- 用具体的东西（具体的工具、具体的人、具体的场景），不说「一个工具」「很多用户」。
- 道理从经历里长出来，一句就够。不写「其实」「所以结论很直接」「串起来看」这类文章腔，不写空泛金句，不用书面转折词（然而、综上所述、值得注意的是）。
- 有【说话样本】时，模仿它的节奏、口头说法、讲故事的方式，不照抄句子。
- 不编造数字和事实；没有出处的数字直接不写，不要换成"好几倍"这种听起来像事实的说法。
- 不写用户没提供的第一人称经历、试用结果、小故事（如"我试过一次，它挑出了……"）。需要亲身例子时写「【待补：你的真实经历】」，让用户自己补。
- 有【用户提供的事实】或【用户的回答】时：稿子里的第一人称经历、测试结果、数字只能来自这两处，其余一律写「【待补：…】」（写清要补什么，如「【待补：低档跑出来的结果】」）。
- 账号定位里举的例子是描述受众和方向的，不是用户的经历，不能写成"我…过"。
- 严格按给定的 6 段结构写；每段字数是参考，全片总时长是硬约束。
- 只输出 JSON：{"title": "视频标题", "segments": [{"role": "段名", "text": "逐字稿"}, ...共 6 段]}。`;

export interface Answer {
  q: string;
  a: string;
}

function firstMessage(o: { direction: string; targetSec: number; personaText: string; reference?: string; lessons?: string; facts?: string; samples?: string[]; answers?: Answer[] }): string {
  const answered = (o.answers ?? []).filter((x) => x.a.trim());
  const parts: string[] = [];
  if (o.personaText) parts.push(`【账号定位】\n${o.personaText}`);
  if (o.samples?.length) parts.push(`【说话样本】（模仿说话方式，不抄句子）\n${o.samples.join('\n---\n')}`);
  if (o.lessons) parts.push(`【写法经验】（来自用户自己的复盘，写稿遵守）\n${o.lessons}`);
  if (o.facts) parts.push(`【用户提供的事实】\n${o.facts}`);
  if (answered.length) parts.push(`【用户的回答】（是事实，经历和数字可以从这里取）\n${answered.map((x) => `问：${x.q}\n答：${x.a.trim()}`).join('\n')}`);
  parts.push(o.facts || answered.length ? `【这条讲什么】（选题方向，不是事实；里面提到的经历、测试结果、数字都只是设想，不能当成真的写进稿子）\n${o.direction}` : `【这条讲什么】\n${o.direction}`);
  if (o.reference) parts.push(`【参考的对标作品】（只借选题、开头钩子的写法、标题思路；不得照抄原句，连续 12 字相同即算照抄）\n${o.reference}`);
  parts.push(`【目标时长】${o.targetSec} 秒，按口语 ${CHARS_PER_SEC} 字/秒`);
  parts.push(`【6 段结构与字数】\n${segmentGuide(o.targetSec)}`);
  return parts.join('\n\n');
}

export function repairMessage(script: Script, report: DurationReport, targetSec: number): string {
  const current = script.segments.map((s, i) => `${i + 1}. ${ROLE_LABEL[s.role]}：${s.text}`).join('\n');
  return `下面这版稿子超时了，请删掉重复和啰嗦的话，优先删偏长的段落，意思不变。\n\n【超标情况】\n${[...report.issues, ...report.hints].join('\n')}\n\n【当前稿子】\n${current}\n\n【6 段结构与字数】\n${segmentGuide(targetSec)}`;
}

export async function writeScript(opts: {
  llm: StructuredLLM;
  direction: string;
  targetSec: number;
  personaText: string;
  reference?: string;
  lessons?: string;
  /** 用户真正提供过的事实(点子原话、原片结尾、对标摘要); 给了就只许从这里取经历和数字 */
  facts?: string;
  /** 用户自己写的口播(最近几篇), 只学说话方式 */
  samples?: string[];
  /** 用户对选题问题的回答; 只用已答的 */
  answers?: Answer[];
}): Promise<{ title: string; script: Script; report: DurationReport; rounds: number }> {
  const call = async (text: string) =>
    (
      await opts.llm.callStructured({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: [{ type: 'text', text }],
        responseSchema: LlmScriptSchema,
      })
    ).result;

  let raw: LlmScript;
  try {
    raw = await call(firstMessage(opts));
  } catch (e) {
    // 原始报错(多为 zod 的英文 JSON)不给用户看
    throw new Error('模型这次没按 6 段格式交稿，没写成。再说一次，或者把方向说具体些。', { cause: e });
  }
  let script = toScript(raw);
  let report = checkDuration(script, opts.targetSec);
  let rounds = 0;
  while (!report.ok && rounds < MAX_REPAIR_ROUNDS) {
    rounds += 1;
    try {
      raw = await call(repairMessage(script, report, opts.targetSec));
    } catch {
      // 自修这一轮格式坏了: 保留上一版可用的稿子, 如实报超标, 不整个丢掉
      break;
    }
    script = toScript(raw);
    report = checkDuration(script, opts.targetSec);
  }
  return { title: raw.title, script, report, rounds };
}
