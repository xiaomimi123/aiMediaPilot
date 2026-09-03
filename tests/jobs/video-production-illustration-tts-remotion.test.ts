import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VideoProduction } from '@prisma/client';

/*
 * 二十九期 Task 2: illustration-tts 的 Remotion 分支。
 *
 * 与 ppt-narration 那条 Remotion 分支共用同一套骨架(handlePptNarrationRemotion,
 * 见其顶部 RemotionShotPlanOptions 说明), 唯一在这里单独功能性验证的是三处刻意
 * 差异里"验证成本最高"的一条: 未配置火山 TTS 时必须直接报错, 不能像 ppt-narration
 * 那样无声降级——这条不适合只用源码正则锚(容易和 ppt-narration 分支共用的字符串
 * 撞在一起), 真跑一遍到抛错为止最直接。
 */

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { VIDEO_PRODUCTION: 'video-production' } }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn(async () => null) },
  volcTtsConfig: { findUnique: vi.fn(async () => null) },
  cockpitContent: { findUnique: vi.fn(async () => ({ id: 'c1', scriptDraftId: 'd1' })) },
  scriptDraft: { findUnique: vi.fn(async () => ({ id: 'd1', output: {} })) },
  contentAsset: { findMany: vi.fn(async () => []) },
  videoProduction: { update: vi.fn(async () => ({})) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const ACTS = [
  { act: 'hook', narration: 'hook 台词', beats: [{ keyword: 'k1' }] },
];
vi.mock('@/lib/cockpit/draft-restore', () => ({
  parseDraftOutput: vi.fn(() => ({ acts: ACTS, four_dims: { gain: 'g', surprise: 's', clarity: 'c', appeal: 'a' } })),
}));
vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => 'fake-deepseek-key') }));

import { handleIllustrationTtsRemotion } from '@/jobs/workers/video-production-worker';

function makeVp(overrides: Partial<VideoProduction> = {}): VideoProduction {
  return {
    id: 'vp1', userId: 'user1', contentId: 'c1', status: 'queued', mode: 'illustration-tts',
    renderer: 'remotion',
    srt: null, productionRoot: '/tmp/vp1', sourceVideoPath: null,
    alignedActs: null, rawTranscript: null, previewPath: null, masterPath: null, templateId: null,
    voiceOverride: null, errorMessage: null, filmPlan: null, productionNotice: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as VideoProduction;
}

const setStatus = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', scriptDraftId: 'd1' });
  prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: {} });
  prismaMock.volcTtsConfig.findUnique.mockResolvedValue(null);
});

describe('handleIllustrationTtsRemotion(preview) — 未配置火山 TTS', () => {
  it('直接抛错, 不走 ppt-narration 那套无声降级(措辞照抄旧链 handleIllustrationTts)', async () => {
    const vp = makeVp();
    await expect(
      handleIllustrationTtsRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath'),
    ).rejects.toThrow('请先在设置页配置火山 TTS');
  });

  it('抛错前不会落库 productionNotice(无声降级那套完全不触发)', async () => {
    const vp = makeVp();
    await expect(
      handleIllustrationTtsRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath'),
    ).rejects.toThrow();
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });
});
