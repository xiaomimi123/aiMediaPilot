import path from 'node:path';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { projectDir, saveStreamToFile } from '@/lib/files/storage';
import { probeVideo, probeVideoDimensions } from '@/lib/video/ffmpeg';
import { materialType, decodeNote, createMaterial } from '@/lib/film/materials';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!project) return fail('项目不存在或已删除', 404);
  const name = decodeNote(req.headers.get('x-filename'));
  const type = materialType(name);
  if (!type) return fail('只支持 png / jpg / webp 图片和 mp4 / mov / m4v 视频', 400);
  if (!req.body) return fail('没收到文件', 400);

  const temp = path.join(projectDir(project.id), `upload-${randomUUID()}.part`);
  try {
    await saveStreamToFile(Readable.fromWeb(req.body as unknown as WebReadableStream), temp);
  } catch {
    return fail('上传中断了，文件没存完整。重新拖进来再传一次。', 400);
  }
  let probe: { durationSec: number | null; width: number; height: number };
  try {
    const dims = await probeVideoDimensions(temp);
    probe = { width: dims.width, height: dims.height, durationSec: type === 'video' ? (await probeVideo(temp)).durationSec : null };
  } catch {
    await fs.unlink(temp).catch(() => {});
    return fail('这个文件读不出来，可能已经损坏。', 400);
  }
  const { id } = await createMaterial(prisma, { projectId: project.id, tempPath: temp, originalName: name, note: decodeNote(req.headers.get('x-note')), probe });
  return ok({ id });
}
