import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const a = await prisma.contentAnalysis.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      videoFilename: true,
      videoDurationSec: true,
      videoMimeType: true,
      status: true,
      errorMessage: true,
      progress: true,
      retryCount: true,
      report: true,
      llmUsage: true,
      coverCandidates: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    },
  });
  if (!a) return fail('not found', 404);
  const covers = (a.coverCandidates as { path: string }[] | null) ?? [];
  return ok({
    id: a.id,
    videoFilename: a.videoFilename,
    videoDurationSec: a.videoDurationSec,
    videoMimeType: a.videoMimeType,
    status: a.status,
    errorMessage: a.errorMessage,
    progress: a.progress,
    retryCount: a.retryCount,
    report: a.report,
    llmUsage: a.llmUsage,
    coverCandidatesCount: covers.length,
    createdAt: a.createdAt,
    startedAt: a.startedAt,
    completedAt: a.completedAt,
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a) return fail('not found', 404);

  // Fix 6: reject DELETE while worker is running — user must cancel first
  if (a.status === 'QUEUED' || a.status === 'PREPROCESSING' || a.status === 'ANALYZING') {
    return fail('任务运行中无法删除,请先取消', 400);
  }

  // 删除磁盘文件 (整个 analysis 目录)
  const UPLOADS_ROOT = process.env.UPLOADS_ROOT || './uploads';
  const analysisDir = path.join(UPLOADS_ROOT, a.id);
  await fs.rm(analysisDir, { recursive: true, force: true }).catch(() => {});

  await prisma.contentAnalysis.delete({ where: { id: params.id } });
  return ok({ id: params.id });
}
