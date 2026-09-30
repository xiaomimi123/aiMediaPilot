import fs from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { JobError, type JobContext, type JobOutcome } from '@/lib/jobs/runner';
import { versionedName, audioName } from '@/lib/files/storage';
import { ScriptSchema, type Script } from '@/lib/script/model';
import type { TranscriptFile, TranscriptLine } from './transcript';
import type { ProofreadResult } from './proofread';
import { compareWithScript } from './compare';

export interface TranscribeDeps {
  extractAudio(videoPath: string, audioPath: string): Promise<void>;
  transcribeAudio(audioPath: string): Promise<{ segments: TranscriptLine[]; durationSec: number }>;
  proofread(script: Script | null, lines: TranscriptLine[]): Promise<ProofreadResult>;
}

export function whisperErrorMessage(e: unknown): string {
  const err = e as { code?: string; killed?: boolean; signal?: string; message?: string; stderr?: string };
  const text = `${err?.message ?? ''}\n${err?.stderr ?? ''}`;
  if (err?.code === 'ENOENT') return '本地转写没装好：找不到 Python（.env 里的 PYTHON_BIN）。装好后点「重试」。';
  if (/No module named ['"]?faster_whisper/.test(text)) return '本地转写没装好：缺 faster-whisper。在 PYTHON_BIN 对应的环境里运行 pip install faster-whisper，然后点「重试」。';
  if (err?.killed || err?.signal === 'SIGTERM') return '转写超时（超过 10 分钟）。视频可能太长，剪短一点重新上传。';
  return '本地转写出错了。点「重试」再跑一次，还不行就把详情发给我。';
}

/** 阶段只前进: 只有写稿中/已定稿会进到已录制 */
const ADVANCE_FROM = ['draft', 'scripted'];

export async function runTranscribe(ctx: JobContext, deps: TranscribeDeps): Promise<JobOutcome> {
  const video = await ctx.db.projectFile.findFirst({
    where: { projectId: ctx.projectId, kind: 'raw_video' },
    orderBy: { version: 'desc' },
  });
  if (!video) throw new JobError('还没有口播视频，先上传一个再转写。', 'no raw_video row');

  const dir = path.dirname(video.path);
  const audio = path.join(dir, audioName(video.version));
  try {
    await deps.extractAudio(video.path, audio);
  } catch (e) {
    throw new JobError('从视频里提取声音失败：视频可能损坏或没有音轨。换一个文件重新上传试试。', e);
  }
  await ctx.progress(0.1);

  let result: { segments: TranscriptLine[]; durationSec: number };
  try {
    result = await deps.transcribeAudio(audio);
  } catch (e) {
    throw new JobError(whisperErrorMessage(e), e);
  } finally {
    await fs.unlink(audio).catch(() => {});
  }
  await ctx.progress(0.8);

  const project = await ctx.db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
  const parsed = ScriptSchema.safeParse(project.script);
  const script = parsed.success ? parsed.data : null;
  const pr = await deps.proofread(script, result.segments);
  await ctx.progress(0.95);

  const file: TranscriptFile = { lines: pr.lines, rawLines: result.segments, durationSec: result.durationSec, proofread: pr.status };
  const tPath = path.join(dir, versionedName('transcript', video.version, '.json'));
  await fs.writeFile(tPath, JSON.stringify(file, null, 2));
  await ctx.db.projectFile.create({
    data: {
      projectId: ctx.projectId,
      kind: 'transcript',
      path: tPath,
      version: video.version,
      meta: { lineCount: pr.lines.length, proofread: pr.status, changed: pr.changed } as Prisma.InputJsonValue,
    },
  });
  if (ADVANCE_FROM.includes(project.stage)) {
    await ctx.db.project.update({ where: { id: ctx.projectId }, data: { stage: 'recorded' } });
  }

  const parts = [`转写完成：${pr.lines.length} 句，约 ${Math.round(result.durationSec)} 秒`];
  if (pr.status === 'done' && pr.changed > 0) parts.push(`，校对改了 ${pr.changed} 处识别错字`);
  if (pr.status === 'failed') parts.push('（自动校对没成功，用的是原始识别结果）');
  parts.push('。');
  if (script) {
    const cmp = compareWithScript(script, pr.lines);
    parts.push(
      cmp.adlibCount || cmp.skippedCount
        ? `和稿子比：${cmp.adlibCount} 句是临场加的，${cmp.skippedCount} 段没讲到。`
        : '和稿子基本一致。',
    );
  }
  return { notice: parts.join('') };
}
