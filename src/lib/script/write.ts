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

function segmentGuide(targetSec: number): string {
  return SEGMENT_ROLES.map((role, i) => {
    const sec = segmentBudgetSec(role, targetSec);
    return `${i + 1}. ${ROLE_LABEL[role]}：约 ${sec} 秒，≈ ${Math.round(sec * CHARS_PER_SEC)} 字`;
  }).join('\n');
}

const SYSTEM_PROMPT = `你是抖音 AI 知识类口播博主的编导，负责写能直接开口念的口播逐字稿。
要求：
- 口语、短句，不用书面转折词（然而、综上所述、值得注意的是）。
- 不编造数字和事实；没把握的写成相对说法（"好几倍""不少人"）。
- 严格按给定的 6 段结构与每段字数写，字数是硬约束。
- 只输出 JSON：{"title": "视频标题", "segments": [{"role": "段名", "text": "逐字稿"}, ...共 6 段]}。`;

function firstMessage(direction: string, targetSec: number, personaText: string): string {
  return `${personaText ? `【账号定位】\n${personaText}\n\n` : ''}【这条讲什么】\n${direction}\n\n【目标时长】${targetSec} 秒，按口语 ${CHARS_PER_SEC} 字/秒\n\n【6 段结构与字数】\n${segmentGuide(targetSec)}`;
}

function repairMessage(script: Script, report: DurationReport, targetSec: number): string {
  const current = script.segments.map((s, i) => `${i + 1}. ${ROLE_LABEL[s.role]}：${s.text}`).join('\n');
  return `下面这版稿子超时了，请只修改超标的段落，其他段落原样保留，意思不变。\n\n【超标情况】\n${report.issues.join('\n')}\n\n【当前稿子】\n${current}\n\n【6 段结构与字数】\n${segmentGuide(targetSec)}`;
}

export async function writeScript(opts: {
  llm: StructuredLLM;
  direction: string;
  targetSec: number;
  personaText: string;
}): Promise<{ title: string; script: Script; report: DurationReport; rounds: number }> {
  const call = async (text: string) =>
    (
      await opts.llm.callStructured({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: [{ type: 'text', text }],
        responseSchema: LlmScriptSchema,
      })
    ).result;

  let raw = await call(firstMessage(opts.direction, opts.targetSec, opts.personaText));
  let script = toScript(raw);
  let report = checkDuration(script, opts.targetSec);
  let rounds = 0;
  while (!report.ok && rounds < MAX_REPAIR_ROUNDS) {
    rounds += 1;
    raw = await call(repairMessage(script, report, opts.targetSec));
    script = toScript(raw);
    report = checkDuration(script, opts.targetSec);
  }
  return { title: raw.title, script, report, rounds };
}
