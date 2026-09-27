import path from 'node:path';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { randomUUID } from 'node:crypto';
import { projectDir, videoExt, saveStreamToFile } from '@/lib/files/storage';
import { probeVideo } from '@/lib/video/ffmpeg';
import { findActiveJob } from '@/lib/jobs/runner';
import { finalizeUpload } from '@/lib/recording/upload';

export const dynamic = 'force-dynamic';

/** 流式上传口播原片: 边收边写盘, 不进内存。成功后自动启动转写。 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!project) return fail('项目不存在或已删除', 404);
  if (await findActiveJob(prisma, project.id, 'transcribe')) return fail('上一个视频还在转写，等它完成再传。', 409);

  const name = decodeURIComponent(req.headers.get('x-filename') ?? '');
  const ext = videoExt(name);
  if (!ext) return fail('只支持 mp4 / mov / m4v 视频', 400);
  if (!req.body) return fail('没收到文件', 400);

  // 先写临时文件, 版本号在收尾时(项目锁内)再分配, 避免并发上传撞同一个文件名
  const tempPath = path.join(projectDir(project.id), `upload-${randomUUID()}.part`);

  let sizeBytes: number;
  try {
    sizeBytes = await saveStreamToFile(Readable.fromWeb(req.body as unknown as WebReadableStream), tempPath);
  } catch {
    return fail('上传中断了，文件没存完整。重新拖进来再传一次。', 400);
  }
  let durationSec: number;
  try {
    durationSec = (await probeVideo(tempPath)).durationSec;
  } catch {
    await fs.unlink(tempPath).catch(() => {});
    return fail('这个文件读不出视频时长，可能不是视频或已经损坏。', 400);
  }

  const r = await finalizeUpload(prisma, { projectId: project.id, tempPath, ext, meta: { originalName: name, sizeBytes, durationSec } });
  if (!r.ok) return fail(r.message, r.status);
  return ok({ fileId: r.fileId, jobId: r.jobId });
}
