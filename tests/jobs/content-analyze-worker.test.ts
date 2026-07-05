import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runPreprocess, runAIAnalysis, extractDimScore } from '@/jobs/workers/content-analyze-worker';
import { RetentionResponseSchema } from '@/lib/llm/prompts/retention';

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { ANALYZE: 'content-analyze' } }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    contentAnalysis: {
      update: vi.fn(async () => ({})),
    },
  },
}));

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

vi.mock('@/lib/llm/local-whisper', () => ({
  LocalWhisperClient: class {
    async transcribe() {
      return { text: 'demo', segments: [], durationSec: 45, estCostUSD: 0 };
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
    expect(result.whisperCostUSD).toBeCloseTo(0); // local faster-whisper = zero cost
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
    niche: 'ai-knowledge',
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

    const result = await runAIAnalysis(baseInput, { visionLLM: fakeLLM, textLLM: fakeLLM, synthesizeLLM: fakeLLM });
    expect(calls).toContain('hook');
    expect(result.report.hook).toHaveProperty('error');
    expect(result.report.retention).not.toHaveProperty('error');
    expect(result.report.titleCaption).not.toHaveProperty('error');
  });

  it('3/4 维通过 → synthesize 仍跑, report.partial=true, availableDimensions 只列 ok', async () => {
    const fakeLLM = {
      async callStructured(opts: any) {
        const sys = opts.systemPrompt as string;
        if (sys.match(/前 3 秒钩子/)) throw new Error('hook LLM broken');
        // synthesize / retention / titleCaption / cover 都从这里出;
        // 用 responseSchema 分流
        const schemaName = opts.responseSchema?._def?.description ?? '';
        if (sys.includes('综合最多 4 个维度')) {
          return {
            result: { overallScore: 66, topActionItems: ['把 0:01 改成提问句', '压缩 0:18'] },
            usage: { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, estCostUSD: 0.001 },
          };
        }
        if (opts.responseSchema === RetentionResponseSchema) {
          return { result: { riskPoints: [], overallSummary: 'ok' }, usage: { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, estCostUSD: 0.001 } };
        }
        return { result: { mode: 'generate', generatedTitles: ['t1','t2','t3'], generatedCaptions: ['c1','c2','c3'] }, usage: { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, estCostUSD: 0.001 } };
      },
    } as any;

    const fsp = await import('fs/promises');
    vi.spyOn(fsp, 'readdir').mockResolvedValue(['frame_0001.jpg'] as any);

    const result = await runAIAnalysis(baseInput, { visionLLM: fakeLLM, textLLM: fakeLLM, synthesizeLLM: fakeLLM });
    expect(result.report.overallScore).toBe(66);
    expect(result.report.topActionItems).toHaveLength(2);
    expect(result.report.partial).toBe(true);
    expect(result.report.availableDimensions).toEqual(['retention', 'titleCaption', 'cover']);
  });

  it('只有 1 维通过 → skip synthesize, overallScore null', async () => {
    const fakeLLM = {
      async callStructured(opts: any) {
        const sys = opts.systemPrompt as string;
        if (opts.responseSchema === RetentionResponseSchema) {
          return { result: { riskPoints: [], overallSummary: 'ok' }, usage: { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, estCostUSD: 0.001 } };
        }
        // hook / titleCaption / cover 全炸
        throw new Error(`${sys.slice(0, 20)} down`);
      },
    } as any;

    const fsp = await import('fs/promises');
    vi.spyOn(fsp, 'readdir').mockResolvedValue(['frame_0001.jpg'] as any);

    const result = await runAIAnalysis(baseInput, { visionLLM: fakeLLM, textLLM: fakeLLM, synthesizeLLM: fakeLLM });
    expect(result.report.overallScore).toBeNull();
    expect(result.report.partial).toBe(false);
    expect(result.report.availableDimensions).toEqual(['retention']);
  });

  it('synthesize 抛错时 computeFallbackScore 用 hook.rating + retention.severity + cover.feedback.rating 加权算出分', async () => {
    // hook 3, retention 干净 = 100, cover evaluate rating 4 → 应该有分
    // titleCaption generate mode → skip
    const fakeLLM = {
      async callStructured(opts: any) {
        const sys = opts.systemPrompt as string;
        if (sys.includes('综合最多 4 个维度')) throw new Error('synthesize down');
        if (opts.responseSchema === RetentionResponseSchema) {
          return { result: { riskPoints: [], overallSummary: 'ok' }, usage: { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, estCostUSD: 0.001 } };
        }
        if (sys.match(/前 3 秒钩子/)) {
          return { result: { rating: 3, summary: '', suggestions: [], keyObservations: [] }, usage: { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, estCostUSD: 0.001 } };
        }
        if (sys.match(/评价或生成视频的标题/)) {
          return { result: { mode: 'generate', generatedTitles: ['t1'], generatedCaptions: ['c1'] }, usage: { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, estCostUSD: 0.001 } };
        }
        // cover
        return { result: { mode: 'evaluate', feedback: { rating: 4, issues: [], suggestions: [] } }, usage: { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, estCostUSD: 0.001 } };
      },
    } as any;

    const fsp = await import('fs/promises');
    vi.spyOn(fsp, 'readdir').mockResolvedValue(['frame_0001.jpg'] as any);

    const result = await runAIAnalysis(baseInput, { visionLLM: fakeLLM, textLLM: fakeLLM, synthesizeLLM: fakeLLM });
    // hook=60 (w=.3), retention=100 (w=.3), cover=80 (w=.2), titleCaption generate → skip
    // totalWeight = .3+.3+.2 = .8;  score = (18 + 30 + 16) / .8 = 64/.8 = 80
    expect(result.report.overallScore).toBe(80);
    expect(result.report.partial).toBe(true);
  });
});

describe('extractDimScore', () => {
  it('hook: rating * 20', () => {
    expect(extractDimScore('hook', { rating: 5 })).toBe(100);
    expect(extractDimScore('hook', { rating: 1 })).toBe(20);
  });

  it('hook: 无 rating → null', () => {
    expect(extractDimScore('hook', { summary: 'x' })).toBeNull();
    expect(extractDimScore('hook', null)).toBeNull();
  });

  it('retention: 无 risk → 100', () => {
    expect(extractDimScore('retention', { riskPoints: [] })).toBe(100);
  });

  it('retention: penalty 累加, clamp 0', () => {
    expect(
      extractDimScore('retention', {
        riskPoints: [{ severity: 'high' }, { severity: 'medium' }, { severity: 'low' }],
      }),
    ).toBe(60); // 100 - 25 - 10 - 5
    expect(
      extractDimScore('retention', {
        riskPoints: Array(10).fill({ severity: 'high' }),
      }),
    ).toBe(0);
  });

  it('titleCaption evaluate: avg of available ratings * 20', () => {
    expect(
      extractDimScore('titleCaption', {
        mode: 'evaluate',
        titleFeedback: { rating: 4 },
        captionFeedback: { rating: 2 },
      }),
    ).toBe(60);
    expect(
      extractDimScore('titleCaption', {
        mode: 'evaluate',
        titleFeedback: { rating: 5 },
      }),
    ).toBe(100);
  });

  it('titleCaption evaluate 无 rating → null; generate mode → null', () => {
    expect(extractDimScore('titleCaption', { mode: 'evaluate' })).toBeNull();
    expect(extractDimScore('titleCaption', { mode: 'generate', generatedTitles: [] })).toBeNull();
  });

  it('cover evaluate: feedback.rating * 20', () => {
    expect(extractDimScore('cover', { mode: 'evaluate', feedback: { rating: 3 } })).toBe(60);
  });

  it('cover generate → null', () => {
    expect(extractDimScore('cover', { mode: 'generate', candidates: [], recommendedIdx: 0 })).toBeNull();
  });
});
