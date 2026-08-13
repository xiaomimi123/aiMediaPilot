import { Worker, type Job } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';
import {
  probeVideo,
  extractFrames,
  extractAudio,
  extractSingleFrame,
} from '@/lib/video/ffmpeg';
import {
  computeFrameSamplingPlan,
  computeCoverCandidateTimestamps,
  computeHookFrameTimestamps,
  pickEvenlySpaced,
} from '@/lib/video/sampling';
import { LocalWhisperClient } from '@/lib/llm/local-whisper';
import type { TranscriptionResult } from '@/lib/llm/whisper';
import { type IVisionLLM, type TokenUsage } from '@/lib/llm/vision';
import { getDeepSeekTextLLM, getOpenAIVisionLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { HOOK, RETENTION, TITLE_CAPTION, COVER, SYNTHESIZE, SYNTHESIZE_WEIGHTS } from '@/lib/llm/prompts';
import { computePrediction } from '@/lib/prediction/formula';
import { resolveBaseline } from '@/lib/prediction/baseline';
import { computeCalibration } from '@/lib/dashboard/calibration';
import type { RetroReportLike } from '@/lib/dashboard/types';
import { Prisma } from '@prisma/client';
import type { ContentAnalysisStatus } from '@prisma/client';

type JobData = { analysisId: string };

async function setStatus(analysisId: string, status: ContentAnalysisStatus, extra: Record<string, unknown> = {}) {
  await prisma.contentAnalysis.update({
    where: { id: analysisId },
    data: { status, ...extra },
  });
}

async function setProgress(
  analysisId: string,
  stage: string,
  percent: number,
  label: string
) {
  await prisma.contentAnalysis.update({
    where: { id: analysisId },
    data: { progress: { stage, percent, label } },
  });
}

export interface PreprocessResult {
  framesDir: string;
  hookFramesDir: string;
  audioPath: string;
  transcriptPath: string;
  coverCandidates: { path: string; timestampSec: number }[];
  durationSec: number;
  whisperCostUSD: number;
}

export interface PreprocessOpts {
  analysisId: string;
  videoPath: string;
  uploadsRoot: string;
  openaiApiKey: string;
}

export async function runPreprocess(opts: PreprocessOpts): Promise<PreprocessResult> {
  // Use string join to preserve relative prefixes like './' that path.join normalises away.
  const sep = opts.uploadsRoot.endsWith('/') ? '' : '/';
  const analysisDir = `${opts.uploadsRoot}${sep}${opts.analysisId}`;
  const framesDir = `${analysisDir}/frames`;
  const hookFramesDir = `${analysisDir}/hook-frames`;
  const coversDir = `${analysisDir}/covers`;
  const audioPath = `${analysisDir}/audio.wav`;
  const transcriptPath = `${analysisDir}/transcript.json`;

  await fs.mkdir(framesDir, { recursive: true });
  await fs.mkdir(hookFramesDir, { recursive: true });
  await fs.mkdir(coversDir, { recursive: true });

  const { durationSec } = await probeVideo(opts.videoPath);
  const plan = computeFrameSamplingPlan(durationSec);

  await setProgress(opts.analysisId, 'preprocess.frames', 10, '抽帧中');
  await extractFrames({ videoPath: opts.videoPath, framesDir, intervalSec: plan.intervalSec });

  await setProgress(opts.analysisId, 'preprocess.audio', 20, '抽音轨中');
  await extractAudio({ videoPath: opts.videoPath, audioPath });

  await setProgress(opts.analysisId, 'preprocess.whisper', 30, 'Whisper 转写中');
  // 本地 faster-whisper, 失败 fail-soft (spec §5.1: 不阻断, 空 transcript)
  let transcription: TranscriptionResult;
  try {
    const localWhisper = new LocalWhisperClient();
    transcription = await localWhisper.transcribe(audioPath);
  } catch (err) {
    console.warn('[content-analyze-worker] Whisper 转写失败, 继续以空 transcript 跑:', err instanceof Error ? err.message : err);
    transcription = { text: '', segments: [], durationSec: 0, estCostUSD: 0 };
  }
  await fs.writeFile(transcriptPath, JSON.stringify(transcription), 'utf-8');

  await setProgress(opts.analysisId, 'preprocess.covers', 45, '抽候选封面');
  const coverTimestamps = computeCoverCandidateTimestamps(durationSec);
  const coverCandidates = await Promise.all(
    coverTimestamps.map(async (t, i) => {
      const outputPath = `${coversDir}/cover_${i}.jpg`;
      await extractSingleFrame({ videoPath: opts.videoPath, timestampSec: t, outputPath });
      return { path: outputPath, timestampSec: t };
    })
  );

  await setProgress(opts.analysisId, 'preprocess.hook', 48, '抽钩子帧');
  const hookTimestamps = computeHookFrameTimestamps();
  await Promise.all(
    hookTimestamps.map((t, i) =>
      extractSingleFrame({
        videoPath: opts.videoPath,
        timestampSec: t,
        outputPath: `${hookFramesDir}/frame_${i}.jpg`,
      })
    )
  );

  return {
    framesDir,
    hookFramesDir,
    audioPath,
    transcriptPath,
    coverCandidates,
    durationSec,
    whisperCostUSD: transcription.estCostUSD,
  };
}

export interface AIAnalysisInput {
  durationSec: number;
  framesDir: string;
  hookFramesDir: string;
  transcript: { text: string; segments: { startSec: number; endSec: number; text: string }[]; durationSec: number };
  coverCandidates: { path: string; timestampSec: number }[];
  draftTitle: string | null;
  draftCaption: string | null;
  draftCoverPath: string | null;
  niche: string;
}

export interface AIAnalysisDeps {
  visionLLM: IVisionLLM;
  textLLM: IVisionLLM;
  synthesizeLLM: IVisionLLM;
}

export interface AIAnalysisResult {
  report: Record<string, any>;
  llmUsage: { byCall: TokenUsage[]; total: TokenUsage };
}

function emptyTotal(): TokenUsage {
  return { model: 'aggregate', promptTokens: 0, completionTokens: 0, estCostUSD: 0 };
}

function accumulate(total: TokenUsage, u: TokenUsage): TokenUsage {
  return {
    model: 'aggregate',
    promptTokens: total.promptTokens + u.promptTokens,
    completionTokens: total.completionTokens + u.completionTokens,
    estCostUSD: total.estCostUSD + u.estCostUSD,
  };
}

async function listFramePaths(framesDir: string): Promise<string[]> {
  const files = await fs.readdir(framesDir);
  return files.filter((f) => f.endsWith('.jpg')).sort().map((f) => path.join(framesDir, f));
}

export async function runAIAnalysis(input: AIAnalysisInput, deps: AIAnalysisDeps): Promise<AIAnalysisResult> {
  const allFrames = await listFramePaths(input.framesDir);

  const hookFrames = await listFramePaths(input.hookFramesDir);
  // Cap at 100 frames to bound LLM cost on long videos (sampling.MAX_FRAMES intent)
  const MAX_RETENTION_FRAMES = 100;
  const retentionFrames = pickEvenlySpaced(allFrames, MAX_RETENTION_FRAMES);

  const transcript03s = input.transcript.segments
    .filter((s) => s.startSec < 3)
    .map((s) => s.text)
    .join(' ');

  const callTracking: { name: string; usage: TokenUsage }[] = [];
  const tracked = async <T>(name: string, fn: () => Promise<{ result: T; usage: TokenUsage }>): Promise<T | { error: string }> => {
    try {
      const out = await fn();
      callTracking.push({ name, usage: out.usage });
      return out.result;
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };

  const [hookResult, retentionResult, titleCaptionResult, coverResult] = await Promise.all([
    tracked('hook', () => deps.visionLLM.callStructured({
      systemPrompt: HOOK.buildSystemPrompt(input.niche),
      userMessage: HOOK.buildUserMessage({
        durationSec: input.durationSec,
        frameImagePaths: hookFrames,
        transcript03s,
      }),
      responseSchema: HOOK.responseSchema,
    })),
    tracked('retention', () => deps.visionLLM.callStructured({
      systemPrompt: RETENTION.buildSystemPrompt(input.niche),
      userMessage: RETENTION.buildUserMessage({
        durationSec: input.durationSec,
        frameImagePaths: retentionFrames,
        transcriptSegments: input.transcript.segments,
      }),
      responseSchema: RETENTION.responseSchema,
    })),
    tracked('titleCaption', () => deps.textLLM.callStructured({
      systemPrompt: TITLE_CAPTION.buildSystemPrompt(input.niche),
      userMessage: TITLE_CAPTION.buildUserMessage({
        transcriptText: input.transcript.text,
        draftTitle: input.draftTitle,
        draftCaption: input.draftCaption,
      }),
      responseSchema: TITLE_CAPTION.responseSchema,
    })),
    tracked('cover', () => deps.visionLLM.callStructured({
      systemPrompt: COVER.buildSystemPrompt(input.niche),
      userMessage: COVER.buildUserMessage({
        transcriptFirstChunk: input.transcript.segments.slice(0, 3).map((s) => s.text).join(' '),
        userCoverPath: input.draftCoverPath,
        candidatePaths: input.coverCandidates.map((c) => c.path),
      }),
      responseSchema: COVER.responseSchema,
    })),
  ]);

  const dimensionResults = {
    hook: hookResult,
    retention: retentionResult,
    titleCaption: titleCaptionResult,
    cover: coverResult,
  };
  const isDimOk = (r: unknown): boolean =>
    r !== null && r !== undefined && !(typeof r === 'object' && r !== null && 'error' in r);
  const okDimNames = (Object.keys(dimensionResults) as (keyof typeof dimensionResults)[]).filter(
    (k) => isDimOk(dimensionResults[k]),
  );

  let overallScore: number | null = null;
  let topActionItems: string[] = [];
  let partial = false;

  // ≥ 2 维通过就跑 synthesize (不再"全或无"), prompt 会告诉 LLM 哪些维度缺失。
  // 只 0-1 个通过则 skip — 单维度评估价值太低, 也没 topActionItems 可跨维度提炼。
  const MIN_DIMS_FOR_SYNTHESIZE = 2;
  if (okDimNames.length >= MIN_DIMS_FOR_SYNTHESIZE) {
    partial = okDimNames.length < 4;
    try {
      const synOut = await deps.synthesizeLLM.callStructured({
        systemPrompt: SYNTHESIZE.buildSystemPrompt(input.niche),
        userMessage: SYNTHESIZE.buildUserMessage(dimensionResults),
        responseSchema: SYNTHESIZE.responseSchema,
      });
      overallScore = synOut.result.overallScore;
      topActionItems = synOut.result.topActionItems;
      callTracking.push({ name: 'synthesize', usage: synOut.usage });
    } catch {
      // synthesize 本身失败: 走加权平均 fallback (从可用维度的 overallScore 字段推)
      const fallback = computeFallbackScore(dimensionResults, okDimNames);
      if (fallback !== null) {
        overallScore = fallback;
        topActionItems = [];
        partial = true;
      }
    }
  }

  const total = callTracking.reduce((acc, c) => accumulate(acc, c.usage), emptyTotal());

  return {
    report: {
      schemaVersion: 1,
      niche: input.niche,
      hook: hookResult,
      retention: retentionResult,
      titleCaption: titleCaptionResult,
      cover: coverResult,
      overallScore,
      topActionItems,
      // 消费方 (dashboard, publish-checklist) 可以据此显示 "*" 或类似标记
      partial,
      availableDimensions: okDimNames,
    },
    llmUsage: { byCall: callTracking.map((c) => c.usage), total },
  };
}

/**
 * synthesize LLM 本身失败时的兜底: 用每个维度的原生字段推 0-100 分。
 *
 * 之前 (P3-18 提交) 读 `dim.overallScore` — 但 4 个维度 schema 都没有这个字段,
 * 所以 fallback 永远返回 null, "部分完成兜底" 彻底是死码。 xhigh review 抓到。
 *
 * 各维度的真实评分字段 (见 lib/llm/prompts/*.ts):
 *  - hook:         `rating` 1-5           → *20 → 20-100
 *  - retention:    riskPoints[].severity   → 100 - Σ penalty (high=25/med=10/low=5) clamp 0
 *  - titleCaption: mode='evaluate' 才有 title/captionFeedback.rating (avg 可用者)
 *                  mode='generate' 时无用户草稿可评, 返回 null (skip 权重)
 *  - cover:        mode='evaluate'.feedback.rating 1-5 → *20
 *                  mode='generate' 时 skip
 */
export function extractDimScore(
  dim: 'hook' | 'retention' | 'titleCaption' | 'cover',
  r: unknown,
): number | null {
  if (!r || typeof r !== 'object') return null;
  const obj = r as Record<string, unknown>;

  if (dim === 'hook') {
    const rating = obj.rating;
    return typeof rating === 'number' ? rating * 20 : null;
  }

  if (dim === 'retention') {
    const risks = obj.riskPoints;
    if (!Array.isArray(risks)) return null;
    let penalty = 0;
    for (const rp of risks) {
      const sev = (rp as { severity?: string })?.severity;
      if (sev === 'high') penalty += 25;
      else if (sev === 'medium') penalty += 10;
      else if (sev === 'low') penalty += 5;
    }
    return Math.max(0, 100 - penalty);
  }

  if (dim === 'titleCaption') {
    if (obj.mode !== 'evaluate') return null;
    const ratings: number[] = [];
    const t = (obj.titleFeedback as { rating?: unknown } | undefined)?.rating;
    const c = (obj.captionFeedback as { rating?: unknown } | undefined)?.rating;
    if (typeof t === 'number') ratings.push(t);
    if (typeof c === 'number') ratings.push(c);
    if (ratings.length === 0) return null;
    return (ratings.reduce((a, b) => a + b, 0) / ratings.length) * 20;
  }

  if (dim === 'cover') {
    if (obj.mode !== 'evaluate') return null;
    const rating = (obj.feedback as { rating?: unknown } | undefined)?.rating;
    return typeof rating === 'number' ? rating * 20 : null;
  }

  return null;
}

function computeFallbackScore(
  results: {
    hook: unknown;
    retention: unknown;
    titleCaption: unknown;
    cover: unknown;
  },
  okDims: (keyof typeof results)[],
): number | null {
  const scores: Array<[keyof typeof results, number]> = [];
  for (const d of okDims) {
    const s = extractDimScore(d, results[d]);
    if (s !== null) scores.push([d, s]);
  }
  if (scores.length === 0) return null;
  const totalWeight = scores.reduce((acc, [d]) => acc + SYNTHESIZE_WEIGHTS[d], 0);
  const weighted = scores.reduce((acc, [d, s]) => acc + (s * SYNTHESIZE_WEIGHTS[d]) / totalWeight, 0);
  return Math.round(weighted);
}

async function handleAnalyze(job: Job<JobData>) {
  const { analysisId } = job.data;
  const analysis = await prisma.contentAnalysis.findUnique({ where: { id: analysisId } });
  if (!analysis) throw new Error(`analysis ${analysisId} not found`);
  if (analysis.status === 'CANCELLED') return;

  const uploadsRoot = process.env.UPLOADS_ROOT || './uploads';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  let framesDir = analysis.framesDir;
  let hookFramesDir = analysis.hookFramesDir;
  let audioPath = analysis.audioPath;
  let transcriptPath = analysis.transcriptPath;
  let coverCandidates = (analysis.coverCandidates as { path: string; timestampSec: number }[] | null) ?? null;
  let durationSec = analysis.videoDurationSec;

  // Tracks Whisper cost when preprocess actually runs this attempt (retry skips preprocess)
  let whisperCostUSD = 0;

  // 如果未预处理 (新任务) 或 retry 后未保留产物 → 跑预处理
  if (!framesDir || !audioPath || !transcriptPath || !coverCandidates || !hookFramesDir) {
    await setStatus(analysisId, 'PREPROCESSING', { startedAt: new Date() });
    const pre = await runPreprocess({
      analysisId,
      videoPath: analysis.videoPath,
      uploadsRoot,
      openaiApiKey: apiKey,
    });
    framesDir = pre.framesDir;
    hookFramesDir = pre.hookFramesDir;
    audioPath = pre.audioPath;
    transcriptPath = pre.transcriptPath;
    coverCandidates = pre.coverCandidates;
    durationSec = pre.durationSec;
    whisperCostUSD = pre.whisperCostUSD;
    await prisma.contentAnalysis.update({
      where: { id: analysisId },
      data: { framesDir, hookFramesDir, audioPath, transcriptPath, coverCandidates, videoDurationSec: durationSec },
    });
  }

  // 取消检查
  const recheck = await prisma.contentAnalysis.findUnique({ where: { id: analysisId }, select: { status: true } });
  if (recheck?.status === 'CANCELLED') return;

  await setStatus(analysisId, 'ANALYZING');

  let transcriptJson: { text: string; segments: { startSec: number; endSec: number; text: string }[]; durationSec: number };
  try {
    transcriptJson = JSON.parse(await fs.readFile(transcriptPath, 'utf-8')) as typeof transcriptJson;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      // Disk artifacts gone — clear DB fields so next retry re-runs preprocess fresh
      await prisma.contentAnalysis.update({
        where: { id: analysisId },
        data: { framesDir: null, audioPath: null, transcriptPath: null, hookFramesDir: null, coverCandidates: Prisma.DbNull },
      });
      throw new Error('Preprocessed artifacts missing on disk; cleared DB state, retry will re-preprocess');
    }
    throw e;
  }

  // OpenAI 配置 — 支持 baseURL 代理 (kedaya/百炼/SiliconFlow 等) + 自定义模型
  const openaiBaseURL = process.env.OPENAI_BASE_URL || undefined;
  const visionModel = process.env.OPENAI_VISION_MODEL || 'gpt-4o';
  const synthesizeModel = process.env.OPENAI_SYNTHESIZE_MODEL || 'gpt-4o-mini';
  // 非 OpenAI 兼容端 (Qwen-VL / GLM-4V 等) 通常不支持 beta.chat.completions.parse 严格模式 → JSON-mode fallback
  const useJsonMode = process.env.OPENAI_USE_JSON_MODE === 'true';

  // vision LLM — hook / retention / cover need video frames
  const visionLLM = getOpenAIVisionLLM({ apiKey, baseURL: openaiBaseURL, defaultModel: visionModel, jsonModeFallback: useJsonMode });

  // text LLM — DeepSeek if configured (设置卡优先, .env 回退), 否则 OpenAI (用 visionModel 保留 v1 行为)
  const deepseekKey = await resolveDeepSeekApiKey(analysis.userId);
  const sharedTextLLM: IVisionLLM = deepseekKey
    ? getDeepSeekTextLLM(deepseekKey)
    : getOpenAIVisionLLM({ apiKey, baseURL: openaiBaseURL, defaultModel: visionModel, jsonModeFallback: useJsonMode });

  // synthesize: DeepSeek 时复用同一实例; 无 DeepSeek 时走 synthesizeModel
  const synthesizeLLM: IVisionLLM = deepseekKey
    ? sharedTextLLM  // 同一实例
    : getOpenAIVisionLLM({ apiKey, baseURL: openaiBaseURL, defaultModel: synthesizeModel, jsonModeFallback: useJsonMode });

  await setProgress(analysisId, 'analyze.dimensions', 50, 'AI 4 维度并行评估');
  const ai = await runAIAnalysis(
    {
      durationSec,
      framesDir,
      hookFramesDir,
      transcript: transcriptJson,
      coverCandidates,
      draftTitle: analysis.draftTitle,
      draftCaption: analysis.draftCaption,
      draftCoverPath: analysis.draftCoverPath,
      niche: analysis.niche || 'ai-knowledge',
    },
    { visionLLM, textLLM: sharedTextLLM, synthesizeLLM }
  );
  await setProgress(analysisId, 'analyze.synthesize', 90, '综合评分');

  // L1 prediction — 确定性公式, fail-soft (插入 predictedPlaysRange 到 report)
  try {
    if (typeof ai.report.overallScore === 'number') {
      const baseline = await resolveBaseline(analysis.userId);
      if (baseline) {
        const retroReports = await prisma.contentAnalysis.findMany({
          where: { userId: analysis.userId, retroStatus: 'COMPLETED' },
          select: { retroReport: true },
        });
        const calibration = computeCalibration(
          retroReports
            .map((r) => r.retroReport as RetroReportLike | null)
            .filter((r): r is RetroReportLike => r !== null)
        );
        ai.report.predictedPlaysRange = computePrediction({
          overallScore: ai.report.overallScore,
          baseline: baseline.value,
          calibration,
          retroSampleCount: baseline.retroSampleCount,
          basisSource: baseline.source,
        });
      }
    }
  } catch (err) {
    console.error('[content-analyze-worker] runPredict failed:', err);
  }

  // Fix 1: inject Whisper cost into llmUsage so it shows up in 烧 $x display
  if (whisperCostUSD > 0) {
    const whisperUsage: TokenUsage = {
      model: 'whisper-1',
      promptTokens: 0,
      completionTokens: 0,
      estCostUSD: whisperCostUSD,
    };
    ai.llmUsage.byCall.push(whisperUsage);
    ai.llmUsage.total = {
      model: 'aggregate',
      promptTokens: ai.llmUsage.total.promptTokens,
      completionTokens: ai.llmUsage.total.completionTokens,
      estCostUSD: ai.llmUsage.total.estCostUSD + whisperCostUSD,
    };
  }

  // Fix 2: guard against cancel-mid-AI race — don't overwrite CANCELLED → COMPLETED
  const updated = await prisma.contentAnalysis.updateMany({
    where: { id: analysisId, status: { not: 'CANCELLED' } },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      report: ai.report as any,
      llmUsage: ai.llmUsage as any,
    },
  });
  if (updated.count === 0) {
    // Was cancelled during AI; bail without overwriting
    return;
  }
}

export function startContentAnalyzeWorker() {
  const worker = new Worker<JobData>(QUEUES.ANALYZE, handleAnalyze, { connection: redis });
  worker.on('failed', (job, err) => {
    console.error('[content-analyze] failed', job?.id, err);
    if (job) {
      prisma.contentAnalysis
        .update({
          where: { id: job.data.analysisId },
          data: { status: 'FAILED', errorMessage: err.message, completedAt: new Date() },
        })
        .catch(() => {});
    }
  });
  worker.on('completed', (job) => {
    console.log('[content-analyze] completed', job.id);
  });
  return worker;
}
