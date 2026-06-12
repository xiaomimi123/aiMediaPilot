import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { analyzeQueue } from '@/jobs/queue';

const MAX_BYTES = 500 * 1024 * 1024;
const ALLOWED_VIDEO_MIME = /^video\/(mp4|quicktime|webm|x-matroska)$/;

const UPLOADS_ROOT = process.env.UPLOADS_ROOT || './uploads';

export async function POST(req: NextRequest | Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('multipart 解析失败', 400);
  }

  const video = form.get('video');
  if (!(video instanceof File)) return fail('缺少 video 字段', 400);
  if (!ALLOWED_VIDEO_MIME.test(video.type)) return fail(`不支持的视频格式: ${video.type}`, 400);
  if (video.size > MAX_BYTES) return fail(`视频超过 500MB 上限 (${(video.size / 1024 / 1024).toFixed(1)} MB)`, 400);

  const draftTitle = (form.get('draftTitle') as string | null) || null;
  const draftCaption = (form.get('draftCaption') as string | null) || null;
  const draftCover = form.get('draftCover');

  const user = await getOrCreateDefaultUser();
  const analysisId = randomUUID().slice(0, 12);
  const analysisDir = path.join(UPLOADS_ROOT, analysisId);
  await fs.mkdir(analysisDir, { recursive: true });

  const ext = video.name.split('.').pop() || 'mp4';
  const videoPath = path.join(analysisDir, `original.${ext}`);
  const videoBuffer = Buffer.from(await video.arrayBuffer());
  await fs.writeFile(videoPath, videoBuffer);

  let draftCoverPath: string | null = null;
  if (draftCover instanceof File && draftCover.size > 0) {
    const coverExt = draftCover.name.split('.').pop() || 'jpg';
    draftCoverPath = path.join(analysisDir, `draft-cover.${coverExt}`);
    await fs.writeFile(draftCoverPath, Buffer.from(await draftCover.arrayBuffer()));
  }

  const analysis = await prisma.contentAnalysis.create({
    data: {
      id: analysisId,
      userId: user.id,
      videoPath,
      videoFilename: video.name,
      videoSizeBytes: video.size,
      videoDurationSec: 0,                    // worker probe 后回填
      videoMimeType: video.type,
      draftTitle,
      draftCaption,
      draftCoverPath: draftCoverPath || undefined,
    },
  });

  await analyzeQueue.add(
    'analyze',
    { analysisId: analysis.id },
    { jobId: `analyze-${analysis.id}`, removeOnComplete: true, removeOnFail: false }
  );

  return ok({ analysisId: analysis.id });
}

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const list = await prisma.contentAnalysis.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      videoFilename: true,
      videoDurationSec: true,
      status: true,
      createdAt: true,
      completedAt: true,
      report: true,
      llmUsage: true,
      progress: true,
    },
  });
  return ok(
    list.map((a) => ({
      id: a.id,
      videoFilename: a.videoFilename,
      videoDurationSec: a.videoDurationSec,
      status: a.status,
      createdAt: a.createdAt,
      completedAt: a.completedAt,
      overallScore: (a.report as any)?.overallScore ?? null,
      topActionItems: ((a.report as any)?.topActionItems ?? []) as string[],
      estCostUSD: (a.llmUsage as any)?.total?.estCostUSD ?? null,
      progress: a.progress,
    }))
  );
}
