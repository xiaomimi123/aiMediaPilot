import type { ScriptAct } from '@/lib/script/six-act';

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
