import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { VIDEO_EXTS } from '@/lib/files/storage';

export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

export function materialType(filename: string): 'image' | 'video' | null {
  const ext = path.extname(filename).toLowerCase();
  if ((IMAGE_EXTS as readonly string[]).includes(ext)) return 'image';
  if ((VIDEO_EXTS as readonly string[]).includes(ext)) return 'video';
  return null;
}

export function decodeNote(header: string | null): string {
  if (!header) return '';
  try {
    return decodeURIComponent(header).slice(0, 200);
  } catch {
    return '';
  }
}

export async function createMaterial(
  db: PrismaClient,
  opts: { projectId: string; tempPath: string; originalName: string; note: string; probe: { durationSec: number | null; width: number; height: number } },
): Promise<{ id: string }> {
  const mediaType = materialType(opts.originalName);
  if (!mediaType) throw new Error('只支持 png / jpg / webp 图片和 mp4 / mov / m4v 视频');
  const dest = path.join(path.dirname(opts.tempPath), `material-${randomUUID()}${path.extname(opts.originalName).toLowerCase()}`);
  await fs.rename(opts.tempPath, dest);
  const f = await db.projectFile.create({
    data: {
      projectId: opts.projectId,
      kind: 'material',
      path: dest,
      version: 1,
      meta: {
        note: opts.note,
        originalName: opts.originalName,
        mediaType,
        width: opts.probe.width,
        height: opts.probe.height,
        ...(opts.probe.durationSec !== null ? { durationSec: opts.probe.durationSec } : {}),
      } as Prisma.InputJsonValue,
    },
  });
  return { id: f.id };
}

async function findMaterial(db: PrismaClient, projectId: string, fileId: string) {
  const f = await db.projectFile.findFirst({ where: { id: fileId, projectId, kind: 'material' } });
  if (!f) throw new Error('素材不存在');
  return f;
}

export async function updateMaterialNote(db: PrismaClient, projectId: string, fileId: string, note: string): Promise<void> {
  const f = await findMaterial(db, projectId, fileId);
  await db.projectFile.update({ where: { id: f.id }, data: { meta: { ...(f.meta as object), note: note.slice(0, 200) } as Prisma.InputJsonValue } });
}

export async function deleteMaterial(db: PrismaClient, projectId: string, fileId: string): Promise<void> {
  const f = await findMaterial(db, projectId, fileId);
  await db.projectFile.delete({ where: { id: f.id } });
  await fs.unlink(f.path).catch(() => {});
}
