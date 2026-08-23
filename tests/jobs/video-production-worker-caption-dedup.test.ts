import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { VideoProduction } from '@prisma/client';

// 终审发现1(Critical): spec §3.2 明文要求"带 templateId 且模板配了 captionStyle 的真人
// 出镜任务, worker 跳过原有的默认 .srt 烧录(由包装段统一烧 .ass), 避免双层字幕; 无模板
// 任务行为不变"——这条规则此前没有任何一个任务认领, 从未被实现: handleTalkingHeadBroll
// 的 preview 与 master 两个分支都无条件调用 burnCaptions 烧默认 .srt 样式字幕, 随后
// handleProduce 的包装段又在已经烧过默认字幕的成片上再烧一遍 .ass, 造成两层字幕叠加。
// 本文件断言修复后: 模板配了 captionStyle 时 burnCaptions 不被调用; 无模板/模板无
// captionStyle 时 burnCaptions 照常调用一次(零迁移)。

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { VIDEO_PRODUCTION: 'video-production' } }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn() },
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

// 复用与 visual-style 测试同样的"按 systemPrompt 关键词识别调用方"策略。
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

const burnCaptionsMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/video/ffmpeg', () => ({
  concatClips: vi.fn(async () => undefined),
  concatAudioTracks: vi.fn(async () => undefined),
  extractAudio: vi.fn(async () => undefined),
  compositeCutawayVideo: vi.fn(async () => undefined),
  burnCaptions: burnCaptionsMock,
  muxAudioTrack: vi.fn(async () => undefined),
}));

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async (p: string) => {
    if (String(p).includes('direction.json')) {
      return JSON.stringify({
        concept: 'x', palette: ['#111111', '#222222', '#333333'],
        shots: [{ shotId: 's1', startMs: 0, endMs: 2000, claim: 'c', visualJob: 'clarify', beats: [{ visibleState: 'a', development: 'b' }, { visibleState: 'c', development: 'd' }] }],
      });
    }
    return '<html></html>';
  }),
  copyFile: vi.fn(async () => undefined),
  access: vi.fn(async () => undefined),
}));
vi.mock('fs', () => ({ promises: fsMock }));

import { handleTalkingHeadBroll } from '@/jobs/workers/video-production-worker';

function makeVp(overrides: Partial<VideoProduction> = {}): VideoProduction {
  return {
    id: 'vp1', userId: 'user1', contentId: 'c1', status: 'queued', mode: 'talking-head-broll',
    srt: '', productionRoot: '/tmp/vp1', sourceVideoPath: '/tmp/source.mp4',
    alignedActs: null, rawTranscript: null, previewPath: null, masterPath: null, templateId: null,
    voiceOverride: null, errorMessage: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as VideoProduction;
}

const setStatus = vi.fn(async () => undefined);

const CAPTION_STYLE = {
  fontFamily: 'PingFang SC', fontSize: 56, primaryColor: '#FFFFFF',
  outlineColor: '#000000', outlineWidth: 3, marginV: 90,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', scriptDraftId: 'd1' });
  prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: {} });
});

describe('handleTalkingHeadBroll(preview) — 跳过默认 .srt 烧录(终审发现1)', () => {
  it('模板配了 captionStyle → 不调用 burnCaptions, 用合成结果原样作为预览产物', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', visualStyle: 'card', captionStyle: CAPTION_STYLE });
    const vp = makeVp({ templateId: 't1' });

    await handleTalkingHeadBroll(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(burnCaptionsMock).not.toHaveBeenCalled();
    expect(fsMock.copyFile).toHaveBeenCalledTimes(1);
  });

  it('模板存在但 captionStyle 为 null → 照常调用 burnCaptions 一次', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', visualStyle: 'card', captionStyle: null });
    const vp = makeVp({ templateId: 't1' });

    await handleTalkingHeadBroll(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(burnCaptionsMock).toHaveBeenCalledTimes(1);
  });

  it('templateId 为空(零迁移)→ 不查模板, 照常调用 burnCaptions 一次', async () => {
    const vp = makeVp({ templateId: null });

    await handleTalkingHeadBroll(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(prismaMock.videoTemplate.findUnique).not.toHaveBeenCalled();
    expect(burnCaptionsMock).toHaveBeenCalledTimes(1);
  });
});

describe('handleTalkingHeadBroll(master) — 跳过默认 .srt 烧录(终审发现1)', () => {
  function masterVp(overrides: Partial<VideoProduction> = {}): VideoProduction {
    return makeVp({
      alignedActs: [{ act: 'hook', startMs: 0, endMs: 1000 }] as unknown as VideoProduction['alignedActs'],
      rawTranscript: [{ startSec: 0, endSec: 1, text: 'hello' }] as unknown as VideoProduction['rawTranscript'],
      ...overrides,
    });
  }

  it('模板配了 captionStyle → 不调用 burnCaptions, 预览与 master 观感保持一致', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', visualStyle: 'card', captionStyle: CAPTION_STYLE });
    const vp = masterVp({ templateId: 't1' });

    await handleTalkingHeadBroll(vp, 'master', setStatus, 'master.mp4', 'done', 'masterPath');

    expect(burnCaptionsMock).not.toHaveBeenCalled();
    expect(fsMock.copyFile).toHaveBeenCalledTimes(1);
  });

  it('templateId 为空(零迁移)→ 照常调用 burnCaptions 一次', async () => {
    const vp = masterVp({ templateId: null });

    await handleTalkingHeadBroll(vp, 'master', setStatus, 'master.mp4', 'done', 'masterPath');

    expect(prismaMock.videoTemplate.findUnique).not.toHaveBeenCalled();
    expect(burnCaptionsMock).toHaveBeenCalledTimes(1);
  });
});
