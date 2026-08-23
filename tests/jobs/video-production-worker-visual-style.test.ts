import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { VideoProduction } from '@prisma/client';
import { BUILDER } from '@/lib/video-production/builder-prompt';

// 终审发现2: template.visualStyle 是死配置——模板编辑器有「视觉风格」下拉, 但 worker 里
// 三处 BUILDER.buildSystemPrompt 调用点的 visualStyle 参数完全硬编码, 从未读 template.visualStyle。
// 本文件断言修复后 template.visualStyle 真的传到了 BUILDER.buildSystemPrompt 的调用参数上。

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { VIDEO_PRODUCTION: 'video-production' } }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn() },
  volcTtsConfig: { findUnique: vi.fn() },
  cockpitContent: { findUnique: vi.fn(async () => ({ id: 'c1', scriptDraftId: 'd1' })) },
  scriptDraft: { findUnique: vi.fn(async () => ({ id: 'd1', output: {} })) },
  videoProduction: { update: vi.fn(async () => ({})) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const ACTS = [
  { act: 'hook', narration: 'hook 台词', beats: [{ keyword: 'k1' }] },
  { act: 'concept_a', narration: 'concept_a 台词', beats: [{ keyword: 'k2' }] },
];
vi.mock('@/lib/cockpit/draft-restore', () => ({
  parseDraftOutput: vi.fn(() => ({ acts: ACTS, four_dims: { gain: 'g', surprise: 's', clarity: 'c', appeal: 'a' } })),
}));

vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => 'fake-deepseek-key') }));

vi.mock('@/lib/llm/local-whisper', () => ({
  LocalWhisperClient: class {
    async transcribe() {
      return {
        text: 'hello world',
        segments: [{ startSec: 0, endSec: 1, text: 'hello' }, { startSec: 1, endSec: 2, text: 'world' }],
        durationSec: 2,
        estCostUSD: 0,
      };
    }
  },
}));

vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn((s: string) => `decrypted:${s}`) }));
vi.mock('@/lib/tts/volcengine', () => ({ synthesizeVolcTts: vi.fn(async () => ({ durationMs: 1000 })) }));

// callStructured 按 systemPrompt 的关键词识别是 ALIGNER/DIRECTOR/BUILDER 里哪一个在调用——
// 三者互不干扰的独立 prompt 文案(ALIGNER含"语音对齐器"/DIRECTOR含"导演"/BUILDER含"构建者"),
// 比按调用顺序猜测更稳健(不同交付模式的调用序列长度不一样)。
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: class {
    constructor(_opts: unknown) {}
    async callStructured(opts: { systemPrompt: string }) {
      if (opts.systemPrompt.includes('语音对齐器')) {
        return {
          result: { acts: [{ act: 'hook', startMs: 0, endMs: 1000 }, { act: 'concept_a', startMs: 1000, endMs: 2000 }] },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
      if (opts.systemPrompt.includes('导演')) {
        return {
          result: {
            concept: 'x', palette: ['#111111', '#222222', '#333333'],
            shots: [{ shotId: 's1', startMs: 0, endMs: 2000, claim: 'c', visualJob: 'clarify', beats: [{ visibleState: 'a', development: 'b' }, { visibleState: 'c', development: 'd' }] }],
          },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
      if (opts.systemPrompt.includes('构建者')) {
        return { result: { html: '<html></html>' }, usage: { inputTokens: 0, outputTokens: 0 } };
      }
      throw new Error(`测试没预期到这个 LLM 调用: ${opts.systemPrompt.slice(0, 20)}`);
    }
  },
}));

vi.mock('@/lib/video-production/shot-renderer', () => ({ renderShotToClip: vi.fn(async () => undefined) }));

vi.mock('@/lib/video/ffmpeg', () => ({
  concatClips: vi.fn(async () => undefined),
  concatAudioTracks: vi.fn(async () => undefined),
  extractAudio: vi.fn(async () => undefined),
  compositeCutawayVideo: vi.fn(async () => undefined),
  burnCaptions: vi.fn(async () => undefined),
  muxAudioTrack: vi.fn(async () => undefined),
}));

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => '<html></html>'),
    copyFile: vi.fn(async () => undefined),
    access: vi.fn(async () => undefined),
  },
}));

import { handlePptNarration, handleTalkingHeadBroll, handleIllustrationTts } from '@/jobs/workers/video-production-worker';

function makeVp(overrides: Partial<VideoProduction> = {}): VideoProduction {
  return {
    id: 'vp1', userId: 'user1', contentId: 'c1', status: 'queued', mode: 'ppt-narration',
    srt: '1\n00:00:00,000 --> 00:00:01,000\nhook\n\n', productionRoot: '/tmp/vp1', sourceVideoPath: '/tmp/source.mp4',
    alignedActs: null, rawTranscript: null, previewPath: null, masterPath: null, templateId: null,
    voiceOverride: null, errorMessage: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as VideoProduction;
}

const setStatus = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', scriptDraftId: 'd1' });
  prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: {} });
  prismaMock.volcTtsConfig.findUnique.mockResolvedValue({ userId: 'user1', apiKey: 'enc-key', voiceType: 'g-voice', resourceId: 'g-res' });
});

describe('handlePptNarration(preview) — visualStyle 接线(终审发现2)', () => {
  it('模板配了 visualStyle=illustration → 传给 BUILDER.buildSystemPrompt 的第二个参数是 illustration', async () => {
    const spy = vi.spyOn(BUILDER, 'buildSystemPrompt');
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', visualStyle: 'illustration' });
    const vp = makeVp({ templateId: 't1' });

    await handlePptNarration(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][1]).toBe('illustration');
  });

  it('templateId 为空(零迁移)→ 不查模板, 沿用硬编码默认值 card', async () => {
    const spy = vi.spyOn(BUILDER, 'buildSystemPrompt');
    const vp = makeVp({ templateId: null });

    await handlePptNarration(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(prismaMock.videoTemplate.findUnique).not.toHaveBeenCalled();
    expect(spy.mock.calls[0][1]).toBe('card');
  });
});

describe('handleTalkingHeadBroll(preview) — visualStyle 接线(终审发现2)', () => {
  it('模板配了 visualStyle=illustration → 传给 BUILDER.buildSystemPrompt 的第二个参数是 illustration', async () => {
    const spy = vi.spyOn(BUILDER, 'buildSystemPrompt');
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', visualStyle: 'illustration', captionStyle: null });
    const vp = makeVp({ mode: 'talking-head-broll', templateId: 't1' });

    await handleTalkingHeadBroll(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(spy.mock.calls[0][1]).toBe('illustration');
  });

  it('templateId 为空(零迁移)→ 不查模板, 沿用硬编码默认值 card', async () => {
    const spy = vi.spyOn(BUILDER, 'buildSystemPrompt');
    const vp = makeVp({ mode: 'talking-head-broll', templateId: null });

    await handleTalkingHeadBroll(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(prismaMock.videoTemplate.findUnique).not.toHaveBeenCalled();
    expect(spy.mock.calls[0][1]).toBe('card');
  });
});

describe('handleIllustrationTts(preview) — visualStyle 接线(终审发现2)', () => {
  it('模板配了 visualStyle=card(与硬编码默认值不同的选择)→ 传给 BUILDER.buildSystemPrompt 的是 card, 不是硬编码的 illustration', async () => {
    const spy = vi.spyOn(BUILDER, 'buildSystemPrompt');
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', visualStyle: 'card', voicePreset: null });
    const vp = makeVp({ mode: 'illustration-tts', templateId: 't1' });

    await handleIllustrationTts(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(spy.mock.calls[0][1]).toBe('card');
  });

  it('templateId 为空(零迁移)→ 不查模板, 沿用硬编码默认值 illustration', async () => {
    const spy = vi.spyOn(BUILDER, 'buildSystemPrompt');
    const vp = makeVp({ mode: 'illustration-tts', templateId: null });

    await handleIllustrationTts(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(spy.mock.calls[0][1]).toBe('illustration');
  });
});
