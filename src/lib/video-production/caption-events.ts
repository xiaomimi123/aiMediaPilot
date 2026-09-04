import type { TranscriptSegment } from '@/lib/llm/whisper';

/**
 * 三十期 Task 3 预备提交：从 `ass-captions.ts` 拆出。`CaptionEvent` 类型与
 * `captionEventsFromTranscript` 是新链（`handlePptNarrationRemotion`/
 * `handleTalkingHeadBrollRemotion` 等）仍在消费的部分，`ass-captions.ts` 其余导出
 * （`buildAssCaptions`/`hexToAssColor`/`formatAssTimestamp`/
 * `captionEventsFromAlignedActs`/`captionEventsFromSrt`）只服务旧渲染层的
 * ASS 字幕烧录，随旧链一起删除。
 */
export interface CaptionEvent {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * 真人出镜模式的字幕事件源 —— ASR 转写的真实原话(不是脚本台词, 用户实际念的可能
 * 与稿子有出入)。TranscriptSegment 的 startSec/endSec 单位是**秒**
 * (与 srt-synthesis.ts 的 buildCaptionSrtFromTranscript 同源)。
 */
export function captionEventsFromTranscript(segments: TranscriptSegment[]): CaptionEvent[] {
  return segments
    .map((s) => ({
      startMs: Math.round(s.startSec * 1000),
      endMs: Math.round(s.endSec * 1000),
      text: s.text.trim(),
    }))
    .filter((e) => e.text.length > 0);
}
