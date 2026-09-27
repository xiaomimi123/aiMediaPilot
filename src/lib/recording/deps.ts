import { extractAudio } from '@/lib/video/ffmpeg';
import { LocalWhisperClient } from '@/lib/llm/local-whisper';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { getDeepSeekKey } from '@/lib/env';
import { proofreadLines } from './proofread';
import type { TranscribeDeps } from './transcribe';

/** 真实依赖。没配 DeepSeek key 时跳过校对(转写照常完成)。 */
export function createTranscribeDeps(): TranscribeDeps {
  const whisper = new LocalWhisperClient();
  return {
    extractAudio: (videoPath, audioPath) => extractAudio({ videoPath, audioPath }),
    transcribeAudio: async (audioPath) => {
      const r = await whisper.transcribe(audioPath);
      return { segments: r.segments, durationSec: r.durationSec };
    },
    proofread: async (script, lines) => {
      const key = getDeepSeekKey();
      if (!key) return { lines, status: 'skipped', changed: 0 };
      return proofreadLines(new DeepSeekTextLLM({ apiKey: key }), script, lines);
    },
  };
}
