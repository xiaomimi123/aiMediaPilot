import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

/** BigInt 转 string 让 JSON.stringify 不抛错。 */
function serializeBigInts(obj: unknown): unknown {
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj as any).map(([k, v]) => [k, serializeBigInts(v)]));
  }
  return obj;
}

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
      // v2 retro 字段
      douyinUrl: true,
      douyinAwemeId: true,
      publishedAt: true,
      retroStatus: true,
      retroErrorMessage: true,
      retroReport: true,
      retroStartedAt: true,
      retroCompletedAt: true,
      actualMetrics: {
        orderBy: { snapshotAt: 'desc' },
        take: 1,
        select: {
          id: true, snapshotAt: true, daysAfterPublish: true, source: true,
          plays: true, likes: true, comments: true, shares: true, collects: true,
          likeRateBp: true, commentRateBp: true, shareRateBp: true,
          completionRateBp: true, retention3sBp: true, followConversionBp: true,
          topComments: true, createdAt: true,
        },
      },
    },
  });
  if (!a) return fail('not found', 404);
  const covers = (a.coverCandidates as { path: string }[] | null) ?? [];
  return ok(serializeBigInts({
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
    // v2
    douyinUrl: a.douyinUrl,
    douyinAwemeId: a.douyinAwemeId,
    publishedAt: a.publishedAt,
    retroStatus: a.retroStatus,
    retroErrorMessage: a.retroErrorMessage,
    retroReport: a.retroReport,
    retroStartedAt: a.retroStartedAt,
    retroCompletedAt: a.retroCompletedAt,
    actualMetric: a.actualMetrics[0] ?? null,
  }));
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a) return fail('not found', 404);

  if (a.status === 'QUEUED' || a.status === 'PREPROCESSING' || a.status === 'ANALYZING') {
    return fail('任务运行中无法删除,请先取消', 400);
  }
  if (a.retroStatus === 'RUNNING') {
    return fail('复盘正在运行,请先取消', 400);
  }

  const UPLOADS_ROOT = process.env.UPLOADS_ROOT || './uploads';
  const analysisDir = path.join(UPLOADS_ROOT, a.id);
  await fs.rm(analysisDir, { recursive: true, force: true }).catch(() => {});

  await prisma.contentAnalysis.delete({ where: { id: params.id } });
  return ok({ id: params.id });
}
