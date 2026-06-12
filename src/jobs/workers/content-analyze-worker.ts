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
} from '@/lib/video/sampling';
import { WhisperClient } from '@/lib/llm/whisper';
import { OpenAIVisionLLM, type IVisionLLM, type TokenUsage } from '@/lib/llm/vision';
import { HOOK } from '@/lib/llm/prompts/ai-knowledge/hook';
import { RETENTION } from '@/lib/llm/prompts/ai-knowledge/retention';
import { TITLE_CAPTION } from '@/lib/llm/prompts/ai-knowledge/title-caption';
import { COVER } from '@/lib/llm/prompts/ai-knowledge/cover';
import { SYNTHESIZE } from '@/lib/llm/prompts/ai-knowledge/synthesize';
import { Prisma } from '@prisma/client';
import type { ContentAnalysisStatus } from '@prisma/client';

type JobData = { analysisId: string };

async function setStatus(analysisId: string, status: ContentAnalysisStatus, extra: Record<string, unknown> = {}) {
  await prisma.contentAnalysis.update({
    where: { id: analysisId },
    data: { status, ...extra },
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

  await extractFrames({ videoPath: opts.videoPath, framesDir, intervalSec: plan.intervalSec });
  await extractAudio({ videoPath: opts.videoPath, audioPath });

  const whisper = new WhisperClient(opts.openaiApiKey);
  const transcription = await whisper.transcribe(audioPath);
  await fs.writeFile(transcriptPath, JSON.stringify(transcription), 'utf-8');

  const coverTimestamps = computeCoverCandidateTimestamps(durationSec);
  const coverCandidates = await Promise.all(
    coverTimestamps.map(async (t, i) => {
      const outputPath = `${coversDir}/cover_${i}.jpg`;
      await extractSingleFrame({ videoPath: opts.videoPath, timestampSec: t, outputPath });
      return { path: outputPath, timestampSec: t };
    })
  );

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
}

export interface AIAnalysisDeps {
  llm: IVisionLLM;
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
  const retentionFrames = allFrames;

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
    tracked('hook', () => deps.llm.callStructured({
      systemPrompt: HOOK.systemPrompt,
      userMessage: HOOK.buildUserMessage({
        durationSec: input.durationSec,
        frameImagePaths: hookFrames,
        transcript03s,
      }),
      responseSchema: HOOK.responseSchema,
      model: 'gpt-4o',
    })),
    tracked('retention', () => deps.llm.callStructured({
      systemPrompt: RETENTION.systemPrompt,
      userMessage: RETENTION.buildUserMessage({
        durationSec: input.durationSec,
        frameImagePaths: retentionFrames,
        transcriptSegments: input.transcript.segments,
      }),
      responseSchema: RETENTION.responseSchema,
      model: 'gpt-4o',
    })),
    tracked('titleCaption', () => deps.llm.callStructured({
      systemPrompt: TITLE_CAPTION.systemPrompt,
      userMessage: TITLE_CAPTION.buildUserMessage({
        transcriptText: input.transcript.text,
        draftTitle: input.draftTitle,
        draftCaption: input.draftCaption,
      }),
      responseSchema: TITLE_CAPTION.responseSchema,
      model: 'gpt-4o',
    })),
    tracked('cover', () => deps.llm.callStructured({
      systemPrompt: COVER.systemPrompt,
      userMessage: COVER.buildUserMessage({
        transcriptFirstChunk: input.transcript.segments.slice(0, 3).map((s) => s.text).join(' '),
        userCoverPath: input.draftCoverPath,
        candidatePaths: input.coverCandidates.map((c) => c.path),
      }),
      responseSchema: COVER.responseSchema,
      model: 'gpt-4o',
    })),
  ]);

  const allOk =
    !('error' in (hookResult as any)) &&
    !('error' in (retentionResult as any)) &&
    !('error' in (titleCaptionResult as any)) &&
    !('error' in (coverResult as any));

  let overallScore: number | null = null;
  let topActionItems: string[] = [];

  if (allOk) {
    try {
      const synOut = await deps.synthesizeLLM.callStructured({
        systemPrompt: SYNTHESIZE.systemPrompt,
        userMessage: SYNTHESIZE.buildUserMessage({
          hook: hookResult,
          retention: retentionResult,
          titleCaption: titleCaptionResult,
          cover: coverResult,
        }),
        responseSchema: SYNTHESIZE.responseSchema,
        model: 'gpt-4o-mini',
      });
      overallScore = synOut.result.overallScore;
      topActionItems = synOut.result.topActionItems;
      callTracking.push({ name: 'synthesize', usage: synOut.usage });
    } catch {
      // synthesize 失败不阻断,留 null
    }
  }

  const total = callTracking.reduce((acc, c) => accumulate(acc, c.usage), emptyTotal());

  return {
    report: {
      schemaVersion: 1,
      niche: 'ai-knowledge',
      hook: hookResult,
      retention: retentionResult,
      titleCaption: titleCaptionResult,
      cover: coverResult,
      overallScore,
      topActionItems,
    },
    llmUsage: { byCall: callTracking.map((c) => c.usage), total },
  };
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

  const llm = new OpenAIVisionLLM({ apiKey, defaultModel: 'gpt-4o' });
  const synthesizeLLM = new OpenAIVisionLLM({ apiKey, defaultModel: 'gpt-4o-mini' });

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
    },
    { llm, synthesizeLLM }
  );

  await prisma.contentAnalysis.update({
    where: { id: analysisId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      report: ai.report,
      llmUsage: ai.llmUsage as any,
    },
  });
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
