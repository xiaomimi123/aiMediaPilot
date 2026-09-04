import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VideoProduction } from '@prisma/client';

/*
 * 三十一期(生成前剪辑台) Task 1: 生成前剪辑台的暂停点状态机。
 *
 * 覆盖三条状态流转:
 * - 开关开(reviewBeforeRender=true) + mode=preview → 产完 FilmPlan 后停在
 *   plan_ready, 不渲染(TTS/ASR/对齐已经跑完并落盘)。
 * - 确认(skipPlanGeneration=true) → 跳过整段生成, 直接复用落盘的 filmPlan/
 *   alignedActs 进入渲染, 渲完到 preview_ready, 不重新调 AI。
 * - 开关关(reviewBeforeRender=false) → 老行为, 一路直达 preview_ready, 不经过
 *   plan_ready。
 *
 * 用 handlePptNarrationRemotion(无 TTS 配置的无声降级分支, 不会抛错——TTS 配置齐全
 * 的分支涉及 tts-manifest/concatAudioTracks/align-captions 等一整套子系统, mock
 * 成本远高于收益, 这条链的"是否暂停"判断与是否有 TTS 配置正交, 无声分支足以覆盖)
 * 真跑一遍, mock 掉 prisma/renderFilm 等外部依赖——照 illustration-tts-remotion.test.ts/
 * talking-head-broll-remotion.test.ts 的先例, 不是源码正则锚点。
 */

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { VIDEO_PRODUCTION: 'video-production' } }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn(async () => null as any) },
  volcTtsConfig: { findUnique: vi.fn(async () => null as any) },
  cockpitContent: { findUnique: vi.fn(async () => ({ id: 'c1', scriptDraftId: 'd1' })) },
  scriptDraft: { findUnique: vi.fn(async () => ({ id: 'd1', output: {} })) },
  videoProduction: { update: vi.fn(async (..._args: any[]) => ({})) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const ACTS = [
  { act: 'hook', title: 'hook', narration: 'hook 台词', visual: '', note: '', targetSec: 5, beats: [{ keyword: 'k1' }], facts: [] },
];
vi.mock('@/lib/cockpit/draft-restore', () => ({
  parseDraftOutput: vi.fn(() => ({
    acts: ACTS,
    four_dims: { gain: 'g', surprise: 's', clarity: 'c', appeal: 'a' },
    research: null,
  })),
}));
vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => 'fake-deepseek-key') }));

const FILM_PLAN_RESULT = {
  shots: [{ shotId: 's1', startMs: 0, endMs: 5000, card: 'statement', slots: { text: '关键数据' } }],
};
const { callStructuredMock, renderFilmMock } = vi.hoisted(() => ({
  callStructuredMock: vi.fn(async (..._args: any[]) => ({ result: {} as any, usage: { completionTokens: 10 } })),
  renderFilmMock: vi.fn(async (..._args: any[]) => undefined),
}));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: vi.fn().mockImplementation(() => ({ callStructured: callStructuredMock })),
}));
vi.mock('@/lib/video-production/remotion-render', () => ({
  renderFilm: renderFilmMock,
  renderShotStill: vi.fn(async () => undefined),
}));
vi.mock('@/lib/video-production/still-check', () => ({
  judgeStillPng: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/video/freeze-check', () => ({
  runFreezeDetect: vi.fn(async () => []),
  buildFreezeReport: vi.fn(() => ({ ok: true, frozenSec: 0, totalSec: 5, segments: [], kind: 'preview', checkedAt: 'x' })),
  DEFAULT_FREEZE_OPTS: {},
}));
vi.mock('@/lib/video/ffmpeg', () => ({
  probeVideoDurationMs: vi.fn(async () => 5000),
  extractAudio: vi.fn(), concatAudioTracks: vi.fn(), probeVideoDimensions: vi.fn(), probeVideo: vi.fn(),
}));

import { handlePptNarrationRemotion } from '@/jobs/workers/video-production-worker';

function makeVp(overrides: Partial<VideoProduction> = {}): VideoProduction {
  return {
    id: 'vp1', userId: 'user1', contentId: 'c1', status: 'queued', mode: 'ppt-narration',
    renderer: 'remotion',
    srt: null, productionRoot: '/tmp/vp1', sourceVideoPath: null,
    alignedActs: null, rawTranscript: null, previewPath: null, masterPath: null, templateId: null,
    voiceOverride: null, errorMessage: null, filmPlan: null, productionNotice: null,
    reviewBeforeRender: true,
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
  callStructuredMock.mockResolvedValue({ result: FILM_PLAN_RESULT, usage: { completionTokens: 10 } });
});

describe('reviewBeforeRender=true, mode=preview — 产完 FilmPlan 停在 plan_ready', () => {
  it('落库 filmPlan/alignedActs 之后调用 setStatus(plan_ready), 不再渲染', async () => {
    const vp = makeVp({ reviewBeforeRender: true });
    await handlePptNarrationRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(prismaMock.videoProduction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ filmPlan: FILM_PLAN_RESULT }) }),
    );
    expect(setStatus).toHaveBeenCalledWith('plan_ready');
    // 不该走到 assembling/渲染那一步
    expect(setStatus).not.toHaveBeenCalledWith('assembling');
    expect(renderFilmMock).not.toHaveBeenCalled();
  });
});

describe('reviewBeforeRender=false, mode=preview — 老行为, 直达 preview_ready', () => {
  it('不停在 plan_ready, 一路渲到底', async () => {
    const vp = makeVp({ reviewBeforeRender: false });
    await handlePptNarrationRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(setStatus).not.toHaveBeenCalledWith('plan_ready');
    expect(setStatus).toHaveBeenCalledWith('assembling');
    expect(renderFilmMock).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith('preview_ready', expect.objectContaining({ previewPath: expect.any(String) }));
  });
});

describe('确认渲染: skipPlanGeneration=true — 跳过整段生成, 复用落盘产物', () => {
  it('不重新调 LLM(callStructured 不被调用), 直接从库里读 filmPlan/alignedActs 渲染', async () => {
    const vp = makeVp({
      reviewBeforeRender: true,
      filmPlan: FILM_PLAN_RESULT,
      alignedActs: [{ act: 'hook', startMs: 0, endMs: 5000 }] as any,
    });
    await handlePptNarrationRemotion(
      vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath',
      undefined, true,
    );

    expect(callStructuredMock).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalledWith('plan_ready');
    expect(renderFilmMock).toHaveBeenCalledTimes(1);
    expect(renderFilmMock.mock.calls[0][0].input.shots).toEqual(FILM_PLAN_RESULT.shots);
    expect(setStatus).toHaveBeenCalledWith('preview_ready', expect.objectContaining({ previewPath: expect.any(String) }));
  });

  /*
   * 变异靶子(照计划要求的"变异"验证)——把 handlePptNarrationRemotion 里
   * `!skipPlanGeneration` 这半句判断删掉(退回 `if (mode === 'preview')`), 上面
   * "不重新调 LLM"那条断言(callStructuredMock 不被调用)会失败: 因为
   * skipPlanGeneration=true 时会重新走生成分支, callStructured 被调用。
   * 这条注释本身不是一个可执行的测试, 是给复审/未来改动的人一个明确的锚点:
   * 这个组合(reviewBeforeRender=true 的 vp + skipPlanGeneration=true)必须走
   * 复用分支, 不能重新生成——上面那条测试就是它的断言。
   */
  it('没有已保存的 filmPlan 时(异常态)仍然抛错, 不会静默重新生成', async () => {
    const vp = makeVp({ reviewBeforeRender: true, filmPlan: null, alignedActs: null });
    await expect(
      handlePptNarrationRemotion(
        vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath',
        undefined, true,
      ),
    ).rejects.toThrow('没有已保存的 FilmPlan');
    expect(callStructuredMock).not.toHaveBeenCalled();
  });
});

describe('master 模式不受 reviewBeforeRender 影响', () => {
  it('reviewBeforeRender=true 时 master 依然一路渲到 done, 不停在 plan_ready', async () => {
    const vp = makeVp({
      reviewBeforeRender: true,
      filmPlan: FILM_PLAN_RESULT,
      alignedActs: [{ act: 'hook', startMs: 0, endMs: 5000 }] as any,
    });
    await handlePptNarrationRemotion(vp, 'master', setStatus, 'master.mp4', 'done', 'masterPath');

    expect(setStatus).not.toHaveBeenCalledWith('plan_ready');
    expect(callStructuredMock).not.toHaveBeenCalled();
    expect(renderFilmMock).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith('done', expect.objectContaining({ masterPath: expect.any(String) }));
  });
});
