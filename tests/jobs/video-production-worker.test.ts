import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { VideoProduction } from '@prisma/client';

// worker 模块顶层会 `new Worker(...)`(startVideoProductionWorker 内)且引入 redis/队列——
// 这里只用到 handleIllustrationTts, 但整个文件的顶层 import 链都要能装载, 照抄
// content-analyze-worker.test.ts 的 mock 范式(redis/queue 挡掉真连接)。
vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { VIDEO_PRODUCTION: 'video-production' } }));

const prismaMock = vi.hoisted(() => ({
  volcTtsConfig: { findUnique: vi.fn() },
  videoTemplate: { findUnique: vi.fn() },
  cockpitContent: { findUnique: vi.fn(async () => ({ id: 'c1', scriptDraftId: 'd1' })) },
  scriptDraft: { findUnique: vi.fn(async () => ({ id: 'd1', output: {} })) },
  videoProduction: { update: vi.fn(async () => ({})) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

// 六幕稿解析结果直接 mock 掉——本测试只关心 TTS 调用参数, 不关心六幕稿怎么落库/解析出来
// (那条链路已经被 draft-restore 自己的单测和 produce 路由测试覆盖过)。
const ACTS = [
  { act: 'hook', narration: 'hook 台词' },
  { act: 'concept_a', narration: 'concept_a 台词' },
];
vi.mock('@/lib/cockpit/draft-restore', () => ({
  parseDraftOutput: vi.fn(() => ({ acts: ACTS, four_dims: { gain: 'g', surprise: 's', clarity: 'c', appeal: 'a' } })),
}));

// apiKey 断言的关键——decrypt 只应该被喂全局 VolcTtsConfig.apiKey, 这里用一个可辨认的
// 前缀直接透传, 断言时能一眼看出解出来的是不是全局配置那份。
vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn((s: string) => `decrypted:${s}`) }));

// 显式标注参数类型——否则 vi.fn(async () => ...) 推出的调用记录是空元组 `[]`, 断言
// `mock.calls[0][2]` 会在本项目 strict tsconfig 下过不了 tsc(同 crud.test.ts 的教训)。
const synthesizeVolcTtsMock = vi.hoisted(() =>
  vi.fn(async (_text: string, _audioPath: string, _opts: { apiKey: string; voiceType: string; resourceId: string }) => ({ durationMs: 1000 })),
);
vi.mock('@/lib/tts/volcengine', () => ({ synthesizeVolcTts: synthesizeVolcTtsMock }));

// 短路点——TTS 循环跑完之后紧接着就是这一步, mock 成抛错等价于"不需要的后续步骤"
// (director/builder/渲染/ffmpeg 那一大段), 让测试保持"轻量", 不用为它们再搭一套 mock。
vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => null) }));

// 防御性 mock——即便短路点之前不会走到这些模块, 也照 content-analyze-worker.test.ts
// 的先例挡掉, 避免这些模块的真实实现在测试环境里出意外副作用。
vi.mock('@/lib/video/ffmpeg', () => ({
  concatClips: vi.fn(async () => undefined),
  concatAudioTracks: vi.fn(async () => undefined),
  extractAudio: vi.fn(async () => undefined),
  compositeCutawayVideo: vi.fn(async () => undefined),
  burnCaptions: vi.fn(async () => undefined),
  muxAudioTrack: vi.fn(async () => undefined),
}));
vi.mock('@/lib/video-production/shot-renderer', () => ({ renderShotToClip: vi.fn(async () => undefined) }));

import { handleIllustrationTts } from '@/jobs/workers/video-production-worker';

const GLOBAL_TTS_CONFIG = { userId: 'user1', apiKey: 'enc-global-key', voiceType: 'global-voice', resourceId: 'global-resource' };

function makeVp(overrides: Partial<VideoProduction> = {}): VideoProduction {
  return {
    id: 'vp1', userId: 'user1', contentId: 'c1', status: 'queued', mode: 'illustration-tts',
    srt: '', productionRoot: '/tmp/vp1', sourceVideoPath: null, alignedActs: null,
    rawTranscript: null, previewPath: null, masterPath: null, templateId: null,
    voiceOverride: null, errorMessage: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as VideoProduction;
}

const setStatus = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.volcTtsConfig.findUnique.mockResolvedValue(GLOBAL_TTS_CONFIG);
  prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', scriptDraftId: 'd1' });
  prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: {} });
});

describe('handleIllustrationTts(preview) — 音色优先级链接线(task-10b 缺口1)', () => {
  it('模板配了 voicePreset 且没有临时覆盖时, 传给 synthesizeVolcTts 的 voiceType/resourceId 是模板的值; apiKey 始终是全局配置解密出来的那个', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1', userId: 'user1', voicePreset: { voiceType: 'template-voice', resourceId: 'template-resource' },
    });
    const vp = makeVp({ templateId: 't1', voiceOverride: null });

    await expect(
      handleIllustrationTts(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath'),
    ).rejects.toThrow('未配置 DeepSeek key'); // 短路点: TTS 循环之后, 我们不关心的部分

    expect(synthesizeVolcTtsMock).toHaveBeenCalled();
    const firstCallOpts = synthesizeVolcTtsMock.mock.calls[0][2];
    expect(firstCallOpts).toEqual({
      apiKey: 'decrypted:enc-global-key',
      voiceType: 'template-voice',
      resourceId: 'template-resource',
    });
  });

  it('有临时覆盖(voiceOverride)时优先用覆盖的音色, 但 apiKey 仍然是同一份全局配置, 不随模板/覆盖变化', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1', userId: 'user1', voicePreset: { voiceType: 'template-voice', resourceId: 'template-resource' },
    });
    const vp = makeVp({ templateId: 't1', voiceOverride: { voiceType: 'override-voice' } });

    await expect(
      handleIllustrationTts(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath'),
    ).rejects.toThrow('未配置 DeepSeek key');

    const firstCallOpts = synthesizeVolcTtsMock.mock.calls[0][2];
    // voiceType 用覆盖的, resourceId 没在覆盖里给, 落回模板的值——同 voice-resolve.test.ts 的字段级优先级。
    expect(firstCallOpts).toEqual({
      apiKey: 'decrypted:enc-global-key',
      voiceType: 'override-voice',
      resourceId: 'template-resource',
    });
  });

  it('templateId 为空(内容详情页旧入口, 零迁移)时, 不查模板, 直接用全局配置; apiKey 同样是全局解密出来的那个', async () => {
    const vp = makeVp({ templateId: null, voiceOverride: null });

    await expect(
      handleIllustrationTts(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath'),
    ).rejects.toThrow('未配置 DeepSeek key');

    expect(prismaMock.videoTemplate.findUnique).not.toHaveBeenCalled();
    const firstCallOpts = synthesizeVolcTtsMock.mock.calls[0][2];
    expect(firstCallOpts).toEqual({
      apiKey: 'decrypted:enc-global-key',
      voiceType: 'global-voice',
      resourceId: 'global-resource',
    });
  });
});
