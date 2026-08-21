import { Worker, type Job } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';
import type { VideoProduction, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { DIRECTOR, type DirectorResponse } from '@/lib/video-production/director-prompt';
import { BUILDER } from '@/lib/video-production/builder-prompt';
import { ALIGNER } from '@/lib/video-production/aligner-prompt';
import { renderShotToClip } from '@/lib/video-production/shot-renderer';
import { buildSrtFromAlignedActs, buildCaptionSrtFromTranscript } from '@/lib/video-production/srt-synthesis';
import {
  concatClips,
  concatAudioTracks,
  extractAudio,
  compositeCutawayVideo,
  burnCaptions,
  muxAudioTrack,
  type CutawaySegment,
} from '@/lib/video/ffmpeg';
import { LocalWhisperClient } from '@/lib/llm/local-whisper';
import type { TranscriptSegment } from '@/lib/llm/whisper';
import { parseDraftOutput } from '@/lib/cockpit/draft-restore';
import { synthesizeVolcTts } from '@/lib/tts/volcengine';
import { decrypt } from '@/lib/crypto';
import { ttsResultsToAlignedActs, type TtsActResult } from '@/lib/video-production/srt-synthesis';
import type { AlignedAct } from '@/lib/video-production/aligner-prompt';

type JobData = { videoProductionId: string; mode: 'preview' | 'master' };

/** setStatus 的类型：内层各 delivery-mode handler 共用同一个闭包实例，不重复实现落库逻辑。 */
type SetStatusFn = (status: string, extra?: Record<string, unknown>) => Promise<unknown>;

function shotDir(productionRoot: string, shotIndex: number): string {
  // shot.shotId 是 LLM 产出的字符串，未做格式约束，不能直接拼进文件路径
  // (可能包含 `..` 等构造出越权写入路径)。目录名固定用数组下标，
  // preview 与 master 两条渲染路径共用同一套下标规则，保证互相能对上。
  return path.join(productionRoot, 'shots', String(shotIndex));
}

/**
 * `ppt-narration` 交付模式 (十八期既有行为，原样从 handleProduce 里抽出，零行为改动)。
 * Director 产出的 SRT 驱动分镜, 全部镜头串联成完整片子(无源出镜视频, 无挖空替换)。
 */
async function handlePptNarration(
  vp: VideoProduction,
  mode: 'preview' | 'master',
  setStatus: SetStatusFn,
  outputFileName: string,
  readyStatus: string,
  outputField: 'previewPath' | 'masterPath',
): Promise<void> {
  const clipPaths: string[] = [];

  if (mode === 'preview') {
    await setStatus('directing');
    const deepseekKey = await resolveDeepSeekApiKey(vp.userId);
    if (!deepseekKey) throw new Error('未配置 DeepSeek key');
    const llm = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-reasoner' });
    const { result: direction } = await llm.callStructured({
      systemPrompt: DIRECTOR.buildSystemPrompt(),
      userMessage: DIRECTOR.buildUserMessage(vp.srt),
      responseSchema: DIRECTOR.responseSchema,
    });
    // 持久化 Director 结果，供后续 approve 之后的 master 渲染复用，
    // 避免正式导出重新调用 DeepSeek 产出和预览不一致的分镜/画面。
    await fs.writeFile(
      path.join(vp.productionRoot, 'direction.json'),
      JSON.stringify(direction),
      'utf-8',
    );

    await setStatus('building');
    const builderLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-chat' });
    let shotIndex = 0;
    for (const shot of direction.shots) {
      const { result: built } = await builderLLM.callStructured({
        systemPrompt: BUILDER.buildSystemPrompt(direction.palette),
        userMessage: BUILDER.buildUserMessage(shot),
        responseSchema: BUILDER.responseSchema,
      });
      const shotWorkDir = shotDir(vp.productionRoot, shotIndex);
      await fs.mkdir(shotWorkDir, { recursive: true });
      // 先落盘原始 HTML（与 renderShotToClip 自己写的 workDir/index.html 分开保存），
      // 这样即便这一镜的渲染后续失败，产出的 HTML 依然能保留下来供 master 复用。
      await fs.writeFile(path.join(shotWorkDir, 'source.html'), built.html, 'utf-8');
      const clipPath = path.join(shotWorkDir, 'clip.mp4');
      await renderShotToClip({
        html: built.html,
        durationMs: shot.endMs - shot.startMs,
        fps: 15, // 预览档固定 15fps
        workDir: shotWorkDir,
        outputClipPath: clipPath,
      });
      clipPaths.push(clipPath);
      shotIndex += 1;
    }
  } else {
    // master 模式：不再调用 Director/Builder，复用 approve 时批准的那份预览产出，
    // 保证正式导出和用户看到并确认的预览在概念/调色/分镜/动画上完全一致。
    let direction: DirectorResponse;
    try {
      const raw = await fs.readFile(path.join(vp.productionRoot, 'direction.json'), 'utf-8');
      direction = JSON.parse(raw) as DirectorResponse;
    } catch {
      throw new Error('预览未完成或已损坏，无法确认导出，请重新生成预览');
    }

    await setStatus('building');
    let shotIndex = 0;
    for (const shot of direction.shots) {
      const shotWorkDir = shotDir(vp.productionRoot, shotIndex);
      const sourceHtmlPath = path.join(shotWorkDir, 'source.html');
      let html: string;
      try {
        html = await fs.readFile(sourceHtmlPath, 'utf-8');
      } catch {
        throw new Error(`预览未完成或已损坏，无法确认导出，请重新生成预览 (镜头缺失: ${shot.shotId})`);
      }
      // master 用独立的 workDir 子目录渲染，天然隔离 frames/index.html，
      // 不会与预览 15fps 跑出来的旧帧混在一起；clip 文件名也不同，不覆盖 clip.mp4。
      const masterWorkDir = path.join(shotWorkDir, 'master');
      await fs.mkdir(masterWorkDir, { recursive: true });
      const clipPath = path.join(shotWorkDir, 'clip-master.mp4');
      await renderShotToClip({
        html,
        durationMs: shot.endMs - shot.startMs,
        fps: 30, // 正式渲染档固定 30fps
        workDir: masterWorkDir,
        outputClipPath: clipPath,
      });
      clipPaths.push(clipPath);
      shotIndex += 1;
    }
  }

  await setStatus('assembling');
  const outputPath = path.join(vp.productionRoot, outputFileName);
  await concatClips({
    clipPaths,
    outputPath,
    concatListPath: path.join(vp.productionRoot, 'concat-list.txt'),
  });

  await setStatus(readyStatus, { [outputField]: outputPath });
}

/**
 * `talking-head-broll` 交付模式 (十九期新增) —— 真人出镜视频 + AI 生成的 B-roll
 * 挖空替换 + 真实字幕烧录。与 ppt-narration 的关键差异：
 * - 时间轴锚点来自真实 ASR 转写 + 语音对齐(ALIGNER)，不是 Director 凭空排布的虚拟时长；
 * - 最终产物是"挖空替换"(compositeCutawayVideo)+"字幕烧录"(burnCaptions)两步合成，
 *   不是纯 AI 分镜片段直接拼接(concatClips)。
 */
async function handleTalkingHeadBroll(
  vp: VideoProduction,
  mode: 'preview' | 'master',
  setStatus: SetStatusFn,
  outputFileName: string,
  readyStatus: string,
  outputField: 'previewPath' | 'masterPath',
): Promise<void> {
  if (!vp.sourceVideoPath) throw new Error('尚未上传出镜视频');
  const sourceVideoPath = vp.sourceVideoPath;

  if (mode === 'preview') {
    // 转写 + 语音对齐 (复用现有 directing 状态值，语义上这里是"转写+对齐")
    await setStatus('directing');
    const audioPath = path.join(vp.productionRoot, 'source-audio.wav');
    await extractAudio({ videoPath: sourceVideoPath, audioPath });
    const whisper = new LocalWhisperClient();
    const transcription = await whisper.transcribe(audioPath);

    // 取六幕脚本 (同 POST /api/v1/cockpit/video-productions 的 route.ts 用的同一条查找链)
    const content = await prisma.cockpitContent.findUnique({ where: { id: vp.contentId } });
    const draft = content?.scriptDraftId
      ? await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } })
      : null;
    const parsed = draft ? parseDraftOutput(draft.output) : null;
    if (!parsed?.acts || !parsed.four_dims) throw new Error('需要先生成六幕脚本');
    const acts = parsed.acts;

    const deepseekKey = await resolveDeepSeekApiKey(vp.userId);
    if (!deepseekKey) throw new Error('未配置 DeepSeek key');
    const alignLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-reasoner' });
    const { result: aligned } = await alignLLM.callStructured({
      systemPrompt: ALIGNER.buildSystemPrompt(),
      userMessage: ALIGNER.buildUserMessage(transcription.segments, acts),
      responseSchema: ALIGNER.responseSchema,
    });
    // 持久化对齐结果：master 渲染直接复用，不重新做 ASR/对齐这类非确定性 AI 调用。
    await prisma.videoProduction.update({
      where: { id: vp.id },
      data: {
        alignedActs: aligned.acts as unknown as Prisma.InputJsonValue,
        rawTranscript: transcription.segments as unknown as Prisma.InputJsonValue,
        updatedAt: new Date().toISOString(),
      },
    });

    const narrations = Object.fromEntries(acts.map((a) => [a.act, a.narration]));
    const srt = buildSrtFromAlignedActs(aligned.acts, narrations);

    await setStatus('building');
    const directorLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-reasoner' });
    const { result: direction } = await directorLLM.callStructured({
      systemPrompt: DIRECTOR.buildSystemPrompt(),
      userMessage: DIRECTOR.buildUserMessage(srt),
      responseSchema: DIRECTOR.responseSchema,
    });
    await fs.writeFile(
      path.join(vp.productionRoot, 'direction.json'),
      JSON.stringify(direction),
      'utf-8',
    );

    const builderLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-chat' });
    const cutawaySegments: CutawaySegment[] = [];
    let shotIndex = 0;
    for (const shot of direction.shots) {
      const { result: built } = await builderLLM.callStructured({
        systemPrompt: BUILDER.buildSystemPrompt(direction.palette),
        userMessage: BUILDER.buildUserMessage(shot),
        responseSchema: BUILDER.responseSchema,
      });
      const shotWorkDir = shotDir(vp.productionRoot, shotIndex);
      await fs.mkdir(shotWorkDir, { recursive: true });
      await fs.writeFile(path.join(shotWorkDir, 'source.html'), built.html, 'utf-8');
      const clipPath = path.join(shotWorkDir, 'clip.mp4');
      await renderShotToClip({
        html: built.html,
        durationMs: shot.endMs - shot.startMs,
        fps: 15, // 预览档固定 15fps，与 ppt-narration 分支一致
        workDir: shotWorkDir,
        outputClipPath: clipPath,
      });
      cutawaySegments.push({ startMs: shot.startMs, endMs: shot.endMs, clipPath });
      shotIndex += 1;
    }

    await setStatus('assembling');
    const compositedPath = path.join(vp.productionRoot, 'composited.mp4');
    await compositeCutawayVideo({ sourceVideoPath, segments: cutawaySegments, outputPath: compositedPath });
    const outputPath = path.join(vp.productionRoot, outputFileName);
    const captionSrt = buildCaptionSrtFromTranscript(transcription.segments);
    await burnCaptions({ videoPath: compositedPath, srt: captionSrt, outputPath });

    await setStatus(readyStatus, { [outputField]: outputPath });
  } else {
    // master 模式：复用持久化的 direction.json/source.html + 已对齐的 alignedActs/rawTranscript，
    // 不重新做 ASR/对齐这类耗时且非确定性的 AI 调用 —— 与 ppt-narration master 分支同一先例。
    if (!vp.alignedActs || !vp.rawTranscript) {
      throw new Error('预览未完成或已损坏，无法确认导出，请重新生成预览');
    }
    const rawTranscript = vp.rawTranscript as unknown as TranscriptSegment[];

    let direction: DirectorResponse;
    try {
      const raw = await fs.readFile(path.join(vp.productionRoot, 'direction.json'), 'utf-8');
      direction = JSON.parse(raw) as DirectorResponse;
    } catch {
      throw new Error('预览未完成或已损坏，无法确认导出，请重新生成预览');
    }

    await setStatus('building');
    const cutawaySegments: CutawaySegment[] = [];
    let shotIndex = 0;
    for (const shot of direction.shots) {
      const shotWorkDir = shotDir(vp.productionRoot, shotIndex);
      const sourceHtmlPath = path.join(shotWorkDir, 'source.html');
      let html: string;
      try {
        html = await fs.readFile(sourceHtmlPath, 'utf-8');
      } catch {
        throw new Error(`预览未完成或已损坏，无法确认导出，请重新生成预览 (镜头缺失: ${shot.shotId})`);
      }
      const masterWorkDir = path.join(shotWorkDir, 'master');
      await fs.mkdir(masterWorkDir, { recursive: true });
      const clipPath = path.join(shotWorkDir, 'clip-master.mp4');
      await renderShotToClip({
        html,
        durationMs: shot.endMs - shot.startMs,
        fps: 30, // 正式渲染档固定 30fps，与 ppt-narration 分支一致
        workDir: masterWorkDir,
        outputClipPath: clipPath,
      });
      cutawaySegments.push({ startMs: shot.startMs, endMs: shot.endMs, clipPath });
      shotIndex += 1;
    }

    await setStatus('assembling');
    // 用独立文件名，与预览档的 composited.mp4 分开，避免 approve→master 渲染中途覆盖预览产物。
    const compositedPath = path.join(vp.productionRoot, 'composited-master.mp4');
    await compositeCutawayVideo({ sourceVideoPath, segments: cutawaySegments, outputPath: compositedPath });
    const outputPath = path.join(vp.productionRoot, outputFileName);
    const captionSrt = buildCaptionSrtFromTranscript(rawTranscript);
    await burnCaptions({ videoPath: compositedPath, srt: captionSrt, outputPath });

    await setStatus(readyStatus, { [outputField]: outputPath });
  }
}

/**
 * `illustration-tts` 交付模式 (二十期新增) —— 无出镜视频, 用火山引擎 TTS 逐幕合成配音,
 * 驱动纯 AI 插画分镜(BUILDER visualStyle='illustration')直接拼接。与另外两个分支的关键差异：
 * - 没有真人出镜视频/ASR，时间轴锚点来自 TTS 逐幕合成的真实音频时长(ttsResultsToAlignedActs)；
 * - 最终产物是"画面拼接(concatClips)+ TTS 配音轨拼接 + 混流(muxAudioTrack)"，
 *   不是 compositeCutawayVideo 那种挖空替换。
 */
async function handleIllustrationTts(
  vp: VideoProduction,
  mode: 'preview' | 'master',
  setStatus: SetStatusFn,
  outputFileName: string,
  readyStatus: string,
  outputField: 'previewPath' | 'masterPath',
): Promise<void> {
  if (mode === 'preview') {
    // TTS 逐幕配音 (复用现有 directing 状态值，语义上这里是"TTS 配音")
    await setStatus('directing');

    // 取六幕脚本 (同 handleTalkingHeadBroll 用的同一条查找链)
    const content = await prisma.cockpitContent.findUnique({ where: { id: vp.contentId } });
    const draft = content?.scriptDraftId
      ? await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } })
      : null;
    const parsed = draft ? parseDraftOutput(draft.output) : null;
    if (!parsed?.acts || !parsed.four_dims) throw new Error('需要先生成六幕脚本');
    const acts = parsed.acts;

    const ttsConfig = await prisma.volcTtsConfig.findUnique({ where: { userId: vp.userId } });
    if (!ttsConfig) throw new Error('请先在设置页配置火山 TTS');
    const apiKey = decrypt(ttsConfig.apiKey);

    const ttsResults: TtsActResult[] = [];
    for (const act of acts) {
      // 扩展名用 .mp3：synthesizeVolcTts 实际写出的是 mp3 编码字节(audio_params.format:'mp3')，
      // 用 .wav 会误导直接翻 productionRoot 目录的人。
      const audioPath = path.join(vp.productionRoot, `tts-${act.act}.mp3`);
      const { durationMs } = await synthesizeVolcTts(act.narration, audioPath, {
        apiKey,
        voiceType: ttsConfig.voiceType,
        resourceId: ttsConfig.resourceId,
      });
      ttsResults.push({ act: act.act, audioPath, durationMs });
    }
    const alignedActs = ttsResultsToAlignedActs(ttsResults);
    // 持久化对齐结果：master 渲染直接复用，不重新调用 TTS(耗真实调用额度)。
    await prisma.videoProduction.update({
      where: { id: vp.id },
      data: {
        alignedActs: alignedActs as unknown as Prisma.InputJsonValue,
        updatedAt: new Date().toISOString(),
      },
    });

    const narrations = Object.fromEntries(acts.map((a) => [a.act, a.narration]));
    const srt = buildSrtFromAlignedActs(alignedActs, narrations);

    await setStatus('building');
    const deepseekKey = await resolveDeepSeekApiKey(vp.userId);
    if (!deepseekKey) throw new Error('未配置 DeepSeek key');
    const directorLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-reasoner' });
    const { result: direction } = await directorLLM.callStructured({
      systemPrompt: DIRECTOR.buildSystemPrompt(),
      userMessage: DIRECTOR.buildUserMessage(srt),
      responseSchema: DIRECTOR.responseSchema,
    });
    await fs.writeFile(
      path.join(vp.productionRoot, 'direction.json'),
      JSON.stringify(direction),
      'utf-8',
    );

    const builderLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-chat' });
    const clipPaths: string[] = [];
    let shotIndex = 0;
    for (const shot of direction.shots) {
      const { result: built } = await builderLLM.callStructured({
        systemPrompt: BUILDER.buildSystemPrompt(direction.palette, 'illustration'),
        userMessage: BUILDER.buildUserMessage(shot),
        responseSchema: BUILDER.responseSchema,
      });
      const shotWorkDir = shotDir(vp.productionRoot, shotIndex);
      await fs.mkdir(shotWorkDir, { recursive: true });
      await fs.writeFile(path.join(shotWorkDir, 'source.html'), built.html, 'utf-8');
      const clipPath = path.join(shotWorkDir, 'clip.mp4');
      await renderShotToClip({
        html: built.html,
        durationMs: shot.endMs - shot.startMs,
        fps: 15, // 预览档固定 15fps，与另外两个分支一致
        workDir: shotWorkDir,
        outputClipPath: clipPath,
      });
      clipPaths.push(clipPath);
      shotIndex += 1;
    }

    await setStatus('assembling');
    const videoOnlyPath = path.join(vp.productionRoot, 'video-only.mp4');
    await concatClips({
      clipPaths,
      outputPath: videoOnlyPath,
      concatListPath: path.join(vp.productionRoot, 'concat-list.txt'),
    });
    // 音频轨拼接：ttsResults 天然按六幕固定顺序排列，与合成 alignedActs 的顺序一致。
    // 注意不能复用 concatClips —— 它对视频用 `-c copy` 纯字节拼接，视频分镜是同一渲染器
    // 产出、编码参数严格一致，字节拼接安全；但 mp3 这类帧编码音频用 -c copy 在拼接点上
    // 不是采样点精确的(实测会有几十毫秒漂移 + Non-monotonic DTS 警告)，而 alignedActs 的
    // 每幕 startMs/endMs 是按 ffprobe 出来的单幕时长累加算出的，假设了拼接后严丝合缝——
    // 漂移会让实际音轨边界和这个假设对不上，随幕数增多累积成画面渐进错位。
    // concatAudioTracks 用同一份 concat demuxer 技巧但强制重编码为 pcm_s16le，规避这个问题。
    const concatenatedAudioPath = path.join(vp.productionRoot, 'tts-audio.wav');
    await concatAudioTracks({
      audioPaths: ttsResults.map((r) => r.audioPath),
      outputPath: concatenatedAudioPath,
      concatListPath: path.join(vp.productionRoot, 'concat-audio-list.txt'),
    });

    const outputPath = path.join(vp.productionRoot, outputFileName);
    await muxAudioTrack({ videoPath: videoOnlyPath, audioPath: concatenatedAudioPath, outputPath });

    await setStatus(readyStatus, { [outputField]: outputPath });
  } else {
    // master 模式：复用持久化的 direction.json/source.html + 已合成的 alignedActs/per-act TTS 音频，
    // 不重新调用 TTS(真实调用额度)/DeepSeek —— 与另外两个分支 master 分支同一先例。
    if (!vp.alignedActs) {
      throw new Error('预览未完成或已损坏，无法确认导出，请重新生成预览');
    }
    const alignedActs = vp.alignedActs as unknown as AlignedAct[];

    let direction: DirectorResponse;
    try {
      const raw = await fs.readFile(path.join(vp.productionRoot, 'direction.json'), 'utf-8');
      direction = JSON.parse(raw) as DirectorResponse;
    } catch {
      throw new Error('预览未完成或已损坏，无法确认导出，请重新生成预览');
    }

    await setStatus('building');
    const clipPaths: string[] = [];
    let shotIndex = 0;
    for (const shot of direction.shots) {
      const shotWorkDir = shotDir(vp.productionRoot, shotIndex);
      const sourceHtmlPath = path.join(shotWorkDir, 'source.html');
      let html: string;
      try {
        html = await fs.readFile(sourceHtmlPath, 'utf-8');
      } catch {
        throw new Error(`预览未完成或已损坏，无法确认导出，请重新生成预览 (镜头缺失: ${shot.shotId})`);
      }
      const masterWorkDir = path.join(shotWorkDir, 'master');
      await fs.mkdir(masterWorkDir, { recursive: true });
      const clipPath = path.join(shotWorkDir, 'clip-master.mp4');
      await renderShotToClip({
        html,
        durationMs: shot.endMs - shot.startMs,
        fps: 30, // 正式渲染档固定 30fps，与另外两个分支一致
        workDir: masterWorkDir,
        outputClipPath: clipPath,
      });
      clipPaths.push(clipPath);
      shotIndex += 1;
    }

    await setStatus('assembling');
    // 用独立文件名，与预览档的 video-only.mp4 分开，避免 approve→master 渲染中途覆盖预览产物。
    const videoOnlyPath = path.join(vp.productionRoot, 'video-only-master.mp4');
    await concatClips({
      clipPaths,
      outputPath: videoOnlyPath,
      concatListPath: path.join(vp.productionRoot, 'concat-list-master.txt'),
    });
    // 复用预览阶段已经拼接好的完整 TTS 音轨(tts-audio.wav，重编码 pcm 后的产物)，音频时长与
    // 画面 fps 无关，不需要因为画面重渲染为 30fps 就重新合成/重新拼接语音——按 alignedActs 里
    // 持久化的顺序(startMs 升序，等同预览阶段合成 ttsResults 时的六幕固定顺序)找回各幕原始
    // mp3 文件仅用于校验其仍然存在；真正参与混流的是预览阶段已拼好的那条完整音轨。
    const orderedActs = [...alignedActs].sort((a, b) => a.startMs - b.startMs);
    for (const a of orderedActs) {
      const perActPath = path.join(vp.productionRoot, `tts-${a.act}.mp3`);
      try {
        await fs.access(perActPath);
      } catch {
        throw new Error(`预览未完成或已损坏，无法确认导出，请重新生成预览 (缺少 ${a.act} 幕配音)`);
      }
    }
    const concatenatedAudioPath = path.join(vp.productionRoot, 'tts-audio.wav');

    const outputPath = path.join(vp.productionRoot, outputFileName);
    await muxAudioTrack({ videoPath: videoOnlyPath, audioPath: concatenatedAudioPath, outputPath });

    await setStatus(readyStatus, { [outputField]: outputPath });
  }
}

async function handleProduce(job: Job<JobData>) {
  const { videoProductionId, mode } = job.data;

  const setStatus: SetStatusFn = (status, extra = {}) =>
    prisma.videoProduction.update({
      where: { id: videoProductionId },
      data: { status, updatedAt: new Date().toISOString(), ...extra },
    });

  try {
    const vp = await prisma.videoProduction.findUnique({ where: { id: videoProductionId } });
    if (!vp) throw new Error(`video production ${videoProductionId} not found`);

    const outputFileName = mode === 'master' ? 'master.mp4' : 'preview.mp4';
    const readyStatus = mode === 'master' ? 'done' : 'preview_ready';
    const outputField: 'previewPath' | 'masterPath' = mode === 'master' ? 'masterPath' : 'previewPath';

    if (mode === 'master' && vp.status !== 'approved') {
      throw new Error(`video production ${videoProductionId} 未处于 approved 状态，拒绝正式渲染 (当前: ${vp.status})`);
    }

    // 外层按交付模式(vp.mode，与本函数的 preview/master 渲染档是两个不同概念)分岔，
    // 各交付模式的具体流程封装成独立函数——ppt-narration 与 talking-head-broll 互不干扰，
    // 后续 illustration-tts (二十期) 可以直接照此形状新增一个分支，不需要改动这两个函数。
    if (vp.mode === 'talking-head-broll') {
      await handleTalkingHeadBroll(vp, mode, setStatus, outputFileName, readyStatus, outputField);
    } else if (vp.mode === 'ppt-narration') {
      await handlePptNarration(vp, mode, setStatus, outputFileName, readyStatus, outputField);
    } else if (vp.mode === 'illustration-tts') {
      await handleIllustrationTts(vp, mode, setStatus, outputFileName, readyStatus, outputField);
    } else {
      throw new Error(`暂不支持的交付模式: ${vp.mode}`);
    }
  } catch (err) {
    await setStatus('failed', { errorMessage: err instanceof Error ? err.message : String(err) });
    throw err; // 让 BullMQ 记一次 failed job，日志可追溯
  }
}

export function startVideoProductionWorker() {
  const worker = new Worker<JobData>(QUEUES.VIDEO_PRODUCTION, handleProduce, { connection: redis });
  worker.on('failed', (job, err) => {
    console.error('[video-production] failed', job?.id, err);
  });
  worker.on('completed', (job) => {
    console.log('[video-production] completed', job.id);
  });
  return worker;
}
