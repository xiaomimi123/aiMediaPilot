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
  extractAudio,
  compositeCutawayVideo,
  burnCaptions,
  type CutawaySegment,
} from '@/lib/video/ffmpeg';
import { LocalWhisperClient } from '@/lib/llm/local-whisper';
import type { TranscriptSegment } from '@/lib/llm/whisper';
import { parseDraftOutput } from '@/lib/cockpit/draft-restore';

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
