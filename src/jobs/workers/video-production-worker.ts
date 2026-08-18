import { Worker, type Job } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { DIRECTOR } from '@/lib/video-production/director-prompt';
import { BUILDER } from '@/lib/video-production/builder-prompt';
import { renderShotToClip } from '@/lib/video-production/shot-renderer';
import { concatClips } from '@/lib/video/ffmpeg';

type JobData = { videoProductionId: string; mode: 'preview' | 'master' };

async function handleProduce(job: Job<JobData>) {
  const { videoProductionId, mode } = job.data;
  const vp = await prisma.videoProduction.findUnique({ where: { id: videoProductionId } });
  if (!vp) throw new Error(`video production ${videoProductionId} not found`);

  const setStatus = (status: string, extra: Record<string, unknown> = {}) =>
    prisma.videoProduction.update({
      where: { id: videoProductionId },
      data: { status, updatedAt: new Date().toISOString(), ...extra },
    });

  const fps = mode === 'master' ? 30 : 15;
  const outputFileName = mode === 'master' ? 'master.mp4' : 'preview.mp4';
  const readyStatus = mode === 'master' ? 'done' : 'preview_ready';
  const outputField = mode === 'master' ? 'masterPath' : 'previewPath';

  try {
    if (mode === 'master' && vp.status !== 'approved') {
      throw new Error(`video production ${videoProductionId} 未处于 approved 状态，拒绝正式渲染 (当前: ${vp.status})`);
    }

    await setStatus('directing');
    const deepseekKey = await resolveDeepSeekApiKey(vp.userId);
    if (!deepseekKey) throw new Error('未配置 DeepSeek key');
    const llm = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-reasoner' });
    const { result: direction } = await llm.callStructured({
      systemPrompt: DIRECTOR.buildSystemPrompt(),
      userMessage: DIRECTOR.buildUserMessage(vp.srt),
      responseSchema: DIRECTOR.responseSchema,
    });

    await setStatus('building');
    const builderLLM = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-chat' });
    const clipPaths: string[] = [];
    for (const shot of direction.shots) {
      const { result: built } = await builderLLM.callStructured({
        systemPrompt: BUILDER.buildSystemPrompt(direction.palette),
        userMessage: BUILDER.buildUserMessage(shot),
        responseSchema: BUILDER.responseSchema,
      });
      const shotWorkDir = path.join(vp.productionRoot, 'shots', shot.shotId);
      await fs.mkdir(shotWorkDir, { recursive: true });
      const clipPath = path.join(shotWorkDir, 'clip.mp4');
      await renderShotToClip({
        html: built.html,
        durationMs: shot.endMs - shot.startMs,
        fps, // 预览档 15fps，approve 后正式渲染档 (mode==='master') 30fps
        workDir: shotWorkDir,
        outputClipPath: clipPath,
      });
      clipPaths.push(clipPath);
    }

    await setStatus('assembling');
    const outputPath = path.join(vp.productionRoot, outputFileName);
    await concatClips({
      clipPaths,
      outputPath,
      concatListPath: path.join(vp.productionRoot, 'concat-list.txt'),
    });

    await setStatus(readyStatus, { [outputField]: outputPath });
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
