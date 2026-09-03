import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VideoProduction } from '@prisma/client';

/*
 * 二十九期 Task 4: `talking-head-broll` 交付链的 Remotion 分支
 * (`handleTalkingHeadBrollRemotion`)。功能性验证, 不是源码正则锚点——这条链
 * 依赖 ASR/ALIGNER/FilmPlan 三次 AI 调用 + renderFilm, 值得真跑一遍(mock 掉
 * 外部依赖)看清楚每一处接线是否传对了参数, 比正则更不容易漏判。
 *
 * 重点覆盖 brief 里明确写出的几处出镜链专属行为:
 * - 时间轴基准是源视频真实时长(ffprobe), 不是分镜时间总和;
 * - FilmPlan 走 FILM_PLAN_BROLL/checkBrollPlanTiming(不要求铺满);
 * - brollEnabled=false 时跳过整个 FilmPlan 生成(shots 空数组);
 * - pip 参数的 clamp(scale/margin 越界值被夹回合法范围);
 * - 字幕走 ASR 逐句(captionEventsFromTranscript), 不是按幕整段铺;
 * - 音频不走独立人声轨(audioFile: null, 出镜原声直通);
 * - master 模式不重跑 ASR/ALIGNER/FilmPlan LLM, 复用持久化产物。
 */

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { VIDEO_PRODUCTION: 'video-production' } }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn(async () => null as any) },
  volcTtsConfig: { findUnique: vi.fn(async () => null as any) },
  cockpitContent: { findUnique: vi.fn(async () => ({ id: 'c1', scriptDraftId: 'd1' })) },
  scriptDraft: { findUnique: vi.fn(async () => ({ id: 'd1', output: {} })) },
  contentAsset: { findMany: vi.fn(async () => []) },
  videoProduction: { update: vi.fn(async (..._args: any[]) => ({})) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const ACT_KEYS = ['hook', 'concept_a', 'concept_b', 'trivia', 'synthesis', 'punchline'] as const;
const ACTS = ACT_KEYS.map((act) => ({
  act, title: act, narration: `${act} 台词`, visual: '', note: '', targetSec: 5,
  beats: [{ keyword: 'k' }], facts: [],
}));

vi.mock('@/lib/cockpit/draft-restore', () => ({
  parseDraftOutput: vi.fn(() => ({
    acts: ACTS,
    four_dims: { gain: 'g', surprise: 's', clarity: 'c', appeal: 'a' },
    research: null,
  })),
}));
vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => 'fake-deepseek-key') }));

// ASR: 固定返回 3 句真实转写。
const TRANSCRIPT_SEGMENTS = [
  { startSec: 0, endSec: 2, text: '大家好' },
  { startSec: 2, endSec: 4, text: '今天讲个数据' },
  { startSec: 4, endSec: 6, text: '谢谢观看' },
];

// ALIGNER 六幕对齐结果: hook 讲到了(0~5000), 其余五幕零时长(没讲到)。
const ALIGNED_RESULT = {
  acts: ACT_KEYS.map((act, i) => (
    i === 0 ? { act, startMs: 0, endMs: 5000 } : { act, startMs: 5000, endMs: 5000 }
  )),
};
// FilmPlan: 一镜, 落在 [1000,3000) —— 满足 sourceMs=10000 的边界与 1200ms 下限。
const FILM_PLAN_RESULT = {
  shots: [{ shotId: 's1', startMs: 1000, endMs: 3000, card: 'statement', slots: { text: '关键数据' } }],
};

// `vi.mock` 工厂是提升(hoist)到文件顶部执行的, 工厂体内引用的变量必须用 `vi.hoisted`
// 包一层才不会撞上"在初始化前访问"——这几个 mock 函数在下面的测试里还要断言调用记录,
// 不能只在工厂内部定义。
const { transcribeMock, callStructuredMock, extractAudioMock, probeVideoDurationMsMock, renderFilmMock } = vi.hoisted(() => ({
  // 初始返回值只是占位——真正用到的转写内容在下面 beforeEach 里通过
  // mockResolvedValue 设置(那时候 TRANSCRIPT_SEGMENTS 已经初始化好了, 这里
  // 工厂体本身在文件顶部被提升执行, 不能引用后面才声明的模块级常量)。
  transcribeMock: vi.fn(async () => ({ text: '', segments: [] as unknown[], durationSec: 0, estCostUSD: 0 })),
  callStructuredMock: vi.fn(async (..._args: any[]) => ({ result: {} as any, usage: {} })),
  extractAudioMock: vi.fn(async (..._args: any[]) => undefined),
  probeVideoDurationMsMock: vi.fn(async () => 10000),
  renderFilmMock: vi.fn(async (..._args: any[]) => undefined),
}));

vi.mock('@/lib/llm/local-whisper', () => ({
  LocalWhisperClient: vi.fn().mockImplementation(() => ({ transcribe: transcribeMock })),
}));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: vi.fn().mockImplementation(() => ({ callStructured: callStructuredMock })),
}));
vi.mock('@/lib/video/ffmpeg', () => ({
  extractAudio: extractAudioMock,
  probeVideoDurationMs: probeVideoDurationMsMock,
  concatClips: vi.fn(), concatAudioTracks: vi.fn(), compositeCutawayVideo: vi.fn(),
  burnCaptions: vi.fn(), probeVideoDimensions: vi.fn(), probeVideo: vi.fn(), muxAudioTrack: vi.fn(),
}));
vi.mock('@/lib/video-production/remotion-render', () => ({ renderFilm: renderFilmMock }));

import { handleTalkingHeadBrollRemotion } from '@/jobs/workers/video-production-worker';

function makeVp(overrides: Partial<VideoProduction> = {}): VideoProduction {
  return {
    id: 'vp1', userId: 'user1', contentId: 'c1', status: 'queued', mode: 'talking-head-broll',
    renderer: 'remotion',
    srt: null, productionRoot: '/tmp/vp1', sourceVideoPath: '/tmp/source.mp4',
    alignedActs: null, rawTranscript: null, previewPath: null, masterPath: null, templateId: null,
    voiceOverride: null, errorMessage: null, filmPlan: null, productionNotice: null,
    sceneLayouts: null,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as VideoProduction;
}

const setStatus = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', scriptDraftId: 'd1' });
  prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: {} });
  prismaMock.videoTemplate.findUnique.mockResolvedValue(null);
  transcribeMock.mockResolvedValue({
    text: '大家好 今天讲个数据 谢谢观看', segments: TRANSCRIPT_SEGMENTS, durationSec: 10, estCostUSD: 0,
  });
  probeVideoDurationMsMock.mockResolvedValue(10000);
  callStructuredMock.mockImplementation(async (opts: { systemPrompt: string }) => {
    if (opts.systemPrompt.includes('语音对齐器')) {
      return { result: ALIGNED_RESULT, usage: {} };
    }
    return { result: FILM_PLAN_RESULT, usage: { completionTokens: 100 } };
  });
});

describe('handleTalkingHeadBrollRemotion(preview) — 没有出镜视频直接抛错', () => {
  it('sourceVideoPath 为空 → 抛错', async () => {
    const vp = makeVp({ sourceVideoPath: null });
    await expect(
      handleTalkingHeadBrollRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath'),
    ).rejects.toThrow('尚未上传出镜视频');
  });
});

describe('handleTalkingHeadBrollRemotion(preview) — 默认(brollEnabled=true)', () => {
  it('ASR/ALIGNER/FilmPlan 三次调用都真的发生了, 且顺序正确', async () => {
    const vp = makeVp();
    await handleTalkingHeadBrollRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(extractAudioMock).toHaveBeenCalledWith({ videoPath: '/tmp/source.mp4', audioPath: expect.stringContaining('source-audio.wav') });
    expect(transcribeMock).toHaveBeenCalled();
    // 两次 callStructured: 一次 ALIGNER(语音对齐器), 一次 FilmPlan(画面编排者)
    expect(callStructuredMock).toHaveBeenCalledTimes(2);
    expect(callStructuredMock.mock.calls[0][0].systemPrompt).toContain('语音对齐器');
    expect(callStructuredMock.mock.calls[1][0].systemPrompt).toContain('画面编排者');
  });

  it('落库 alignedActs/rawTranscript(供 master 复用), 再落库 filmPlan', async () => {
    const vp = makeVp();
    await handleTalkingHeadBrollRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    const calls = prismaMock.videoProduction.update.mock.calls;
    expect(calls[0][0].data.alignedActs).toEqual(ALIGNED_RESULT.acts);
    expect(calls[0][0].data.rawTranscript).toEqual(TRANSCRIPT_SEGMENTS);
    expect(calls[1][0].data.filmPlan).toEqual(FILM_PLAN_RESULT);
  });

  it('renderFilm: 时间轴基准是源视频真实时长(ffprobe), 不是分镜时间总和', async () => {
    const vp = makeVp();
    await handleTalkingHeadBrollRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    expect(renderFilmMock).toHaveBeenCalledTimes(1);
    const call = renderFilmMock.mock.calls[0][0];
    // fps=15(预览档), sourceMs=10000 → 150 帧。如果基准错用了分镜的 endMs(3000ms/15fps=45 帧)
    // 这里就会是 45 而不是 150。
    expect(call.durationInFrames).toBe(150);
    expect(call.fps).toBe(15);
  });

  it('renderFilm: 音频不走独立人声轨(出镜原声直通), sourceVideoFile 传源视频路径', async () => {
    const vp = makeVp();
    await handleTalkingHeadBrollRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    const call = renderFilmMock.mock.calls[0][0];
    expect(call.audioFile).toBeNull();
    expect(call.input.audioSrc).toBeNull();
    expect(call.sourceVideoFile).toBe('/tmp/source.mp4');
  });

  it('renderFilm: 字幕走 ASR 逐句(captionEventsFromTranscript), 不是按幕整段铺', async () => {
    const vp = makeVp();
    await handleTalkingHeadBrollRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    const call = renderFilmMock.mock.calls[0][0];
    expect(call.input.captions).toEqual([
      { text: '大家好', startMs: 0, endMs: 2000 },
      { text: '今天讲个数据', startMs: 2000, endMs: 4000 },
      { text: '谢谢观看', startMs: 4000, endMs: 6000 },
    ]);
  });

  it('renderFilm: 默认版式 cutaway, 无 pip', async () => {
    const vp = makeVp();
    await handleTalkingHeadBrollRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    const call = renderFilmMock.mock.calls[0][0];
    expect(call.input.sourceVideo).toEqual({ src: '', layout: 'cutaway', pip: null });
  });

  it('renderFilm: visualStyle 固定为 card(这条链没有插画概念)', async () => {
    const vp = makeVp();
    await handleTalkingHeadBrollRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');
    expect(renderFilmMock.mock.calls[0][0].input.visualStyle).toBe('card');
  });
});

describe('handleTalkingHeadBrollRemotion(preview) — brollEnabled=false', () => {
  it('跳过整个 FilmPlan 生成(只有 1 次 callStructured, 是 ALIGNER), shots 落空数组', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1', brollEnabled: false, talkingHeadLayout: 'cutaway',
      pipPosition: 'br', pipScale: 0.25, pipMargin: 40, aspect: '9:16', bgmPath: null,
    });
    const vp = makeVp({ templateId: 't1' });
    await handleTalkingHeadBrollRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    // 只有 ALIGNER 那一次调用, FilmPlan 的"画面编排者"调用没有发生
    expect(callStructuredMock).toHaveBeenCalledTimes(1);
    expect(callStructuredMock.mock.calls[0][0].systemPrompt).toContain('语音对齐器');

    const filmPlanUpdateCall = prismaMock.videoProduction.update.mock.calls[1][0];
    expect(filmPlanUpdateCall.data.filmPlan).toEqual({ shots: [] });

    const call = renderFilmMock.mock.calls[0][0];
    expect(call.input.shots).toEqual([]);
  });
});

describe('handleTalkingHeadBrollRemotion(preview) — pip 版式的 clamp', () => {
  it('scale/margin 越界值被夹回 [PIP_SCALE_MIN, PIP_SCALE_MAX] / >= 0', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1', brollEnabled: true, talkingHeadLayout: 'pip',
      pipPosition: 'tl', pipScale: 1.5, pipMargin: -10, aspect: '16:9', bgmPath: null,
    });
    const vp = makeVp({ templateId: 't1' });
    await handleTalkingHeadBrollRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    const call = renderFilmMock.mock.calls[0][0];
    expect(call.input.sourceVideo).toEqual({
      src: '', layout: 'pip', pip: { position: 'tl', scale: 0.45, margin: 0 },
    });
  });

  it('合法范围内的值原样传递, 不被 clamp 误改', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1', brollEnabled: true, talkingHeadLayout: 'pip',
      pipPosition: 'br', pipScale: 0.3, pipMargin: 20, aspect: '16:9', bgmPath: null,
    });
    const vp = makeVp({ templateId: 't1' });
    await handleTalkingHeadBrollRemotion(vp, 'preview', setStatus, 'preview.mp4', 'preview_ready', 'previewPath');

    const call = renderFilmMock.mock.calls[0][0];
    expect(call.input.sourceVideo.pip).toEqual({ position: 'br', scale: 0.3, margin: 20 });
  });
});

describe('handleTalkingHeadBrollRemotion(master) — 复用持久化产物, 不重跑 AI 调用', () => {
  it('不调用 ASR/ALIGNER/FilmPlan LLM, 复用已保存的 filmPlan/alignedActs/rawTranscript', async () => {
    const vp = makeVp({
      filmPlan: FILM_PLAN_RESULT,
      alignedActs: ALIGNED_RESULT.acts as any,
      rawTranscript: TRANSCRIPT_SEGMENTS as any,
    });
    await handleTalkingHeadBrollRemotion(vp, 'master', setStatus, 'master.mp4', 'done', 'masterPath');

    expect(transcribeMock).not.toHaveBeenCalled();
    expect(callStructuredMock).not.toHaveBeenCalled();
    expect(renderFilmMock).toHaveBeenCalledTimes(1);
    expect(renderFilmMock.mock.calls[0][0].input.shots).toEqual(FILM_PLAN_RESULT.shots);
    expect(renderFilmMock.mock.calls[0][0].fps).toBe(30); // 正式渲染档
  });

  it('没有已保存的 filmPlan → 抛错', async () => {
    const vp = makeVp({ filmPlan: null, alignedActs: ALIGNED_RESULT.acts as any, rawTranscript: TRANSCRIPT_SEGMENTS as any });
    await expect(
      handleTalkingHeadBrollRemotion(vp, 'master', setStatus, 'master.mp4', 'done', 'masterPath'),
    ).rejects.toThrow('没有已保存的 FilmPlan');
  });

  it('没有已保存的 alignedActs/rawTranscript → 抛错', async () => {
    const vp = makeVp({ filmPlan: FILM_PLAN_RESULT, alignedActs: null, rawTranscript: null });
    await expect(
      handleTalkingHeadBrollRemotion(vp, 'master', setStatus, 'master.mp4', 'done', 'masterPath'),
    ).rejects.toThrow('预览未完成或已损坏');
  });

  it('brollEnabled=false 时预览落库的空 shots FilmPlan, master 也能正常复用(不炸在 FilmPlanSchema.min(1)上)', async () => {
    const vp = makeVp({
      filmPlan: { shots: [] },
      alignedActs: ALIGNED_RESULT.acts as any,
      rawTranscript: TRANSCRIPT_SEGMENTS as any,
    });
    await handleTalkingHeadBrollRemotion(vp, 'master', setStatus, 'master.mp4', 'done', 'masterPath');
    expect(renderFilmMock.mock.calls[0][0].input.shots).toEqual([]);
  });
});
