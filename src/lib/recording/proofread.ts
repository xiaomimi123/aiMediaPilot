import { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';
import { ROLE_LABEL, type Script } from '@/lib/script/model';
import type { TranscriptLine } from './transcript';

/**
 * 按原稿校对识别错字。本地 whisper 会把"赛道"听成"室看"、"类目第一"听成"LAM第一",
 * 而转写会变成字幕上片。校对只修错字, 不能把说话人的临场发挥改回稿子原文 ——
 * 所以每一行的修改幅度用编辑距离守门: 改动 ≤3 字或 ≤34% 才采纳, 否则当它在"重写", 保留原识别。
 */
export const MAX_CORRECTION_RATIO = 0.34;
/** 短句里修一个专有名词("室看"→"赛道"、"LAM"→"类目")按比例会超标, 所以少量绝对改动也放行 */
export const MAX_ABS_EDITS = 3;

export function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

export function acceptCorrection(orig: string, fixed: string): string {
  const f = fixed.trim();
  if (!f) return orig;
  const dist = editDistance(orig, f);
  const ratio = dist / Math.max(Array.from(orig).length, Array.from(f).length, 1);
  return dist <= MAX_ABS_EDITS || ratio <= MAX_CORRECTION_RATIO ? f : orig;
}

export type ProofreadResult = { lines: TranscriptLine[]; status: 'done' | 'skipped' | 'failed'; changed: number };

const ProofreadSchema = z.object({ lines: z.array(z.string()) });

const SYSTEM_PROMPT = `你是口播转写的校对员。给你一份语音识别结果（逐行，带行号）和博主的原稿。
只修正识别错的字词：同音字、专有名词、英文名、数字写法。
不改说话人的原话、口头禅、语气词和临场发挥，不把原话改回原稿，不增删句子。
只输出 JSON：{"lines": ["第1行校对后", "第2行校对后", ...]}，行数必须与输入完全一致。`;

export async function proofreadLines(llm: StructuredLLM, script: Script | null, lines: TranscriptLine[]): Promise<ProofreadResult> {
  if (!script || lines.length === 0) return { lines, status: 'skipped', changed: 0 };
  const scriptText = script.segments.map((s) => `${ROLE_LABEL[s.role]}：${s.text}`).join('\n');
  const input = lines.map((l, i) => `${i + 1}. ${l.text}`).join('\n');
  try {
    const { result } = await llm.callStructured({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: [{ type: 'text', text: `【原稿】\n${scriptText}\n\n【识别结果，共 ${lines.length} 行】\n${input}` }],
      responseSchema: ProofreadSchema,
    });
    if (result.lines.length !== lines.length) return { lines, status: 'failed', changed: 0 };
    let changed = 0;
    const out = lines.map((l, i) => {
      const text = acceptCorrection(l.text, result.lines[i]);
      if (text !== l.text) changed++;
      return { ...l, text };
    });
    return { lines: out, status: 'done', changed };
  } catch {
    return { lines, status: 'failed', changed: 0 };
  }
}
