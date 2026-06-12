import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runPreprocess, runAIAnalysis } from '@/jobs/workers/content-analyze-worker';
import { RetentionResponseSchema } from '@/lib/llm/prompts/ai-knowledge/retention';

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
    readdir: vi.fn(async () => [] as string[]),
    readFile: vi.fn(async () => ''),
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      readdir: vi.fn(async () => [] as string[]),
      readFile: vi.fn(async () => ''),
    },
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
    expect(result.hookFramesDir).toBe('./uploads/a1/hook-frames');
    expect(result.audioPath).toBe('./uploads/a1/audio.wav');
    expect(result.transcriptPath).toBe('./uploads/a1/transcript.json');
    expect(result.coverCandidates).toHaveLength(3);
    expect(result.durationSec).toBe(45);
    expect(result.whisperCostUSD).toBeCloseTo(0.005);
  });
});

describe('runAIAnalysis (fail-soft)', () => {
  const baseInput = {
    durationSec: 45,
    framesDir: '/frames',
    hookFramesDir: '/hook-frames',
    transcript: { text: 'demo', segments: [], durationSec: 45 },
    coverCandidates: [{ path: '/c.jpg', timestampSec: 0 }],
    draftTitle: null,
    draftCaption: null,
    draftCoverPath: null,
  };

  it('1 个维度失败,其他维度继续', async () => {
    const calls: string[] = [];
    const fakeLLM = {
      async callStructured(opts: any) {
        const sys = opts.systemPrompt as string;
        if (sys.match(/前 3 秒钩子/)) {
          calls.push('hook');
          throw new Error('hook LLM broken');
        }
        calls.push('other');
        if (opts.responseSchema === RetentionResponseSchema) {
          return { result: { riskPoints: [], overallSummary: 'ok' }, usage: { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, estCostUSD: 0.001 } };
        }
        return { result: { mode: 'generate', generatedTitles: ['t1','t2','t3'], generatedCaptions: ['c1','c2','c3'] }, usage: { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, estCostUSD: 0.001 } };
      },
    } as any;

    const fsp = await import('fs/promises');
    vi.spyOn(fsp, 'readdir').mockResolvedValue(['frame_0001.jpg'] as any); // works for any path

    const result = await runAIAnalysis(baseInput, { llm: fakeLLM, synthesizeLLM: fakeLLM });
    expect(calls).toContain('hook');
    expect(result.report.hook).toHaveProperty('error');
    expect(result.report.retention).not.toHaveProperty('error');
    expect(result.report.titleCaption).not.toHaveProperty('error');
  });
});
