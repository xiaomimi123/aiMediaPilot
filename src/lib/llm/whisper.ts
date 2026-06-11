import OpenAI from 'openai';
import { createReadStream } from 'fs';
import { estimateWhisperCostUSD } from './pricing';

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  durationSec: number;
  estCostUSD: number;
}

export class WhisperClient {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    const resp = await this.client.audio.transcriptions.create({
      file: createReadStream(audioPath) as any,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
    const r = resp as unknown as {
      text: string;
      duration: number;
      segments?: { start: number; end: number; text: string }[];
    };
    return {
      text: r.text,
      durationSec: r.duration,
      segments: (r.segments ?? []).map((s) => ({
        startSec: s.start,
        endSec: s.end,
        text: s.text,
      })),
      estCostUSD: estimateWhisperCostUSD(r.duration),
    };
  }
}
