import { Worker, type Job } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { DIRECTOR, type DirectorResponse } from '@/lib/video-production/director-prompt';
import { BUILDER } from '@/lib/video-production/builder-prompt';
import { renderShotToClip } from '@/lib/video-production/shot-renderer';
import { concatClips } from '@/lib/video/ffmpeg';

type JobData = { videoProductionId: string; mode: 'preview' | 'master' };

function shotDir(productionRoot: string, shotIndex: number): string {
  // shot.shotId 是 LLM 产出的字符串，未做格式约束，不能直接拼进文件路径
  // (可能包含 `..` 等构造出越权写入路径)。目录名固定用数组下标，
  // preview 与 master 两条渲染路径共用同一套下标规则，保证互相能对上。
  return path.join(productionRoot, 'shots', String(shotIndex));
}

async function handleProduce(job: Job<JobData>) {
  const { videoProductionId, mode } = job.data;

  const setStatus = (status: string, extra: Record<string, unknown> = {}) =>
    prisma.videoProduction.update({
      where: { id: videoProductionId },
      data: { status, updatedAt: new Date().toISOString(), ...extra },
    });

  try {
    const vp = await prisma.videoProduction.findUnique({ where: { id: videoProductionId } });
    if (!vp) throw new Error(`video production ${videoProductionId} not found`);

    const outputFileName = mode === 'master' ? 'master.mp4' : 'preview.mp4';
    const readyStatus = mode === 'master' ? 'done' : 'preview_ready';
    const outputField = mode === 'master' ? 'masterPath' : 'previewPath';

    if (mode === 'master' && vp.status !== 'approved') {
      throw new Error(`video production ${videoProductionId} 未处于 approved 状态，拒绝正式渲染 (当前: ${vp.status})`);
    }

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
