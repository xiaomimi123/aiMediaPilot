import type { ActKey, ScriptAct } from '@/lib/script/six-act';
import type { AlignedAct } from './aligner-prompt';
import type { TranscriptSegment } from '@/lib/llm/whisper';

/**
 * 六幕脚本 → SRT 合成纯函数 (十三期任务二)。
 *
 * 无人出镜成片场景下没有真人配音, 用不到语音识别产出的时间戳, 但后续 AI 视频管线
 * (Task 6 起) 仍需要一份"时间锚定"的逐字稿来驱动分镜/字幕。本函数按每幕的
 * targetSec 与句子字符数占比, 在纯前端/服务端均可运行地合成一份标准 SRT——
 * 不依赖任何真实语音时长, 只是六幕脚本既有字段的确定性重排。
 */

/** 按全角句末标点 (。！？) 切句, 标点保留在句尾; 未以标点结尾的残余文字视为切不出句子, 丢弃。 */
function splitSentences(narration: string): string[] {
  const parts = narration.split(/([。！？])/);
  const sentences: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const sentence = `${parts[i]}${parts[i + 1]}`.trim();
    if (sentence) sentences.push(sentence);
  }
  return sentences;
}

function formatTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(millis)}`;
}

/**
 * 逐幕处理: 按句子字符数占比把 act.targetSec 分配给各句 (最后一句吸收四舍五入余数,
 * 保证幕内各句时长之和精确等于 targetSec, 避免跨幕累计产生漂移)。
 * 空 narration / 切不出句子的幕不产生 SRT 条目, 但游标仍推进 targetSec。
 */
export function synthesizeSrtFromSixActScript(acts: ScriptAct[]): string {
  let cursorMs = 0;
  let index = 1;
  let output = '';

  for (const act of acts) {
    const targetMs = act.targetSec * 1000;
    const sentences = splitSentences(act.narration);

    if (sentences.length === 0) {
      cursorMs += targetMs;
      continue;
    }

    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
    const durationsMs: number[] = [];
    let allocatedMs = 0;
    for (let i = 0; i < sentences.length - 1; i += 1) {
      const durationMs = Math.round((targetMs * sentences[i].length) / totalChars);
      durationsMs.push(durationMs);
      allocatedMs += durationMs;
    }
    durationsMs.push(targetMs - allocatedMs);

    for (let i = 0; i < sentences.length; i += 1) {
      const startMs = cursorMs;
      const endMs = cursorMs + durationsMs[i];
      output += `${index}\n${formatTimestamp(startMs)} --> ${formatTimestamp(endMs)}\n${sentences[i]}\n\n`;
      index += 1;
      cursorMs = endMs;
    }
  }

  return output;
}

/**
 * 对齐结果 → 真实 SRT 合成纯函数 (十九期)。
 *
 * 与 synthesizeSrtFromSixActScript 不同, 本函数消费的是语音对齐产出的
 * 真实起止时间戳 (AlignedAct), 而非按 targetSec/字符数估算的虚拟时长。
 * 过滤掉零时长 (startMs === endMs, 即未讲到的幕) 的条目, 其余按 startMs
 * 排序后逐条生成标准 SRT 块, 序号从 1 连续递增、不因跳过的幕留空号。
 */
export function buildSrtFromAlignedActs(
  alignedActs: AlignedAct[],
  narrations: Record<string, string>,
): string {
  const sorted = [...alignedActs]
    .filter((a) => a.startMs !== a.endMs)
    .sort((a, b) => a.startMs - b.startMs);

  let output = '';
  let index = 1;
  for (const aligned of sorted) {
    const text = narrations[aligned.act];
    if (text === undefined) {
      throw new Error(`缺少 ${aligned.act} 幕的字幕文本`);
    }
    output += `${index}\n${formatTimestamp(aligned.startMs)} --> ${formatTimestamp(aligned.endMs)}\n${text}\n\n`;
    index += 1;
  }

  return output;
}

/**
 * ASR 原始转写 → 字幕烧录用 SRT (十九期)。
 *
 * 与 buildSrtFromAlignedActs 不同——这里不做任何六幕语义对齐, 只是把真实
 * 逐句转写(真人出镜原话)按顺序原样转成标准 SRT 字幕块, 每个 segment 对应
 * 一条字幕, 序号从 1 连续递增。用于 talking-head-broll 交付模式的最终
 * 字幕烧录(burnCaptions), 与"六幕对齐结果"(buildSrtFromAlignedActs, 驱动
 * Director/Builder 分镜) 是两条独立用途、互不影响的 SRT 生成路径。
 */
export function buildCaptionSrtFromTranscript(segments: TranscriptSegment[]): string {
  let output = '';
  segments.forEach((segment, i) => {
    output += `${i + 1}\n${formatTimestamp(segment.startSec * 1000)} --> ${formatTimestamp(segment.endSec * 1000)}\n${segment.text.trim()}\n\n`;
  });
  return output;
}

/** 单幕 TTS 合成结果 (十九期): 每幕已合成语音的真实文件路径与真实时长。 */
export interface TtsActResult {
  act: ActKey;
  audioPath: string;
  durationMs: number;
}

/**
 * TTS 逐幕合成结果 → AlignedAct[] (十九期, 插画模式)。
 *
 * 与 ALIGNER (Task 4, ASR 驱动) 得到 AlignedAct 的方式不同——这里没有真人录音、
 * 也无需语义对齐: 每幕的语音是逐幕单独合成的, 天然按 results 数组顺序(六幕固定
 * 顺序)首尾相接拼成一条完整语音轨道, 所以只需按顺序累加 durationMs 即得每幕在
 * 这条轨道里的 startMs/endMs。输出与 Task 4 的 AlignedAct 同构, 可直接喂给
 * buildSrtFromAlignedActs。纯函数, 不调用任何 TTS 接口。
 */
export function ttsResultsToAlignedActs(results: TtsActResult[]): AlignedAct[] {
  let cursorMs = 0;
  return results.map((result) => {
    const startMs = cursorMs;
    const endMs = cursorMs + Math.max(0, result.durationMs);
    cursorMs = endMs;
    return { act: result.act, startMs, endMs };
  });
}
