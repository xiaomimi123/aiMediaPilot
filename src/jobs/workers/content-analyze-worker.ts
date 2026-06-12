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
} from '@/lib/video/sampling';
import { WhisperClient } from '@/lib/llm/whisper';
import type { ContentAnalysisStatus } from '@prisma/client';

type JobData = { analysisId: string };

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_MS = 8 * 60 * 1000;

async function setStatus(analysisId: string, status: ContentAnalysisStatus, extra: Record<string, unknown> = {}) {
  await prisma.contentAnalysis.update({
    where: { id: analysisId },
    data: { status, ...extra },
  });
}

export interface PreprocessResult {
  framesDir: string;
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
  const coversDir = `${analysisDir}/covers`;
  const audioPath = `${analysisDir}/audio.wav`;
  const transcriptPath = `${analysisDir}/transcript.json`;

  await fs.mkdir(framesDir, { recursive: true });
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

  return {
    framesDir,
    audioPath,
    transcriptPath,
    coverCandidates,
    durationSec,
    whisperCostUSD: transcription.estCostUSD,
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

  await setStatus(analysisId, 'PREPROCESSING', { startedAt: new Date() });

  const pre = await runPreprocess({
    analysisId,
    videoPath: analysis.videoPath,
    uploadsRoot,
    openaiApiKey: apiKey,
  });

  await prisma.contentAnalysis.update({
    where: { id: analysisId },
    data: {
      framesDir: pre.framesDir,
      audioPath: pre.audioPath,
      transcriptPath: pre.transcriptPath,
      coverCandidates: pre.coverCandidates,
      videoDurationSec: pre.durationSec,
    },
  });

  // Task 13 接 AI 阶段
  throw new Error('AI stage not yet implemented (Task 13)');
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
