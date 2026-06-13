import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { TranscriptionResult } from './whisper';

const execFileAsync = promisify(execFile);

const DEFAULT_SCRIPT_PATH = path.join(process.cwd(), 'src', 'lib', 'llm', 'local_whisper.py');

export class LocalWhisperClient {
  constructor(
    private pythonBin: string = process.env.PYTHON_BIN || 'python3',
    private scriptPath: string = DEFAULT_SCRIPT_PATH,
  ) {}

  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    const outputPath = path.join(os.tmpdir(), `whisper-${path.basename(audioPath, path.extname(audioPath))}-${Date.now()}.json`);
    try {
      await execFileAsync(this.pythonBin, [this.scriptPath, audioPath, outputPath], {
        timeout: 10 * 60_000, // 10 分钟硬上限 — 本地推理慢 (~1x realtime for "small" model on CPU)
      });
      const json = JSON.parse(await fs.readFile(outputPath, 'utf-8'));
      return {
        text: json.text,
        segments: json.segments,
        durationSec: json.durationSec,
        estCostUSD: 0, // 本地推理零成本
      };
    } finally {
      await fs.unlink(outputPath).catch(() => {});
    }
  }
}
