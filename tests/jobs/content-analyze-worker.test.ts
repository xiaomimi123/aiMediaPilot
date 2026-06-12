import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runPreprocess } from '@/jobs/workers/content-analyze-worker';

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { ANALYZE: 'content-analyze' } }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

vi.mock('@/lib/video/ffmpeg', () => ({
  probeVideo:           vi.fn(async () => ({ durationSec: 45, formatName: 'mp4' })),
  extractFrames:        vi.fn(async () => undefined),
  extractAudio:         vi.fn(async () => undefined),
  extractSingleFrame:   vi.fn(async () => undefined),
}));

vi.mock('@/lib/llm/whisper', () => ({
  WhisperClient: class {
    async transcribe() {
      return { text: 'demo', segments: [], durationSec: 45, estCostUSD: 0.005 };
    }
  },
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
});

beforeEach(() => vi.clearAllMocks());

describe('runPreprocess', () => {
  it('45 秒视频抽 45 帧 + 音轨 + 3 张候选封面', async () => {
    const result = await runPreprocess({
      analysisId: 'a1',
      videoPath: './uploads/a1/original.mp4',
      uploadsRoot: './uploads',
      openaiApiKey: 'sk-x',
    });
    expect(result.framesDir).toBe('./uploads/a1/frames');
    expect(result.audioPath).toBe('./uploads/a1/audio.wav');
    expect(result.transcriptPath).toBe('./uploads/a1/transcript.json');
    expect(result.coverCandidates).toHaveLength(3);
    expect(result.durationSec).toBe(45);
    expect(result.whisperCostUSD).toBeCloseTo(0.005);
  });
});
