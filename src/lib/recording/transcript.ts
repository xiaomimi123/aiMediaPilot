import fs from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

export interface TranscriptLine {
  startSec: number;
  endSec: number;
  text: string;
}

export interface TranscriptFile {
  /** 校对后的逐句(界面与后续特效编排都用这份) */
  lines: TranscriptLine[];
  /** whisper 原始识别, 留作对照 */
  rawLines: TranscriptLine[];
  durationSec: number;
  proofread: 'done' | 'skipped' | 'failed';
}

const LineSchema = z.object({ startSec: z.number(), endSec: z.number(), text: z.string() });
export const TranscriptFileSchema: z.ZodType<TranscriptFile> = z.object({
  lines: z.array(LineSchema),
  rawLines: z.array(LineSchema),
  durationSec: z.number(),
  proofread: z.enum(['done', 'skipped', 'failed']),
});

export async function loadLatestTranscript(
  db: PrismaClient,
  projectId: string,
): Promise<{ fileId: string; version: number; data: TranscriptFile } | null> {
  const f = await db.projectFile.findFirst({ where: { projectId, kind: 'transcript' }, orderBy: { version: 'desc' } });
  if (!f) return null;
  try {
    const parsed = TranscriptFileSchema.safeParse(JSON.parse(await fs.readFile(f.path, 'utf8')));
    return parsed.success ? { fileId: f.id, version: f.version, data: parsed.data } : null;
  } catch {
    return null;
  }
}

/** 只返回与最新口播视频同版本的转写: 重传后新视频还没转写完(或失败)时, 不能拿旧录音当现状 */
export async function loadCurrentTranscript(
  db: PrismaClient,
  projectId: string,
): Promise<{ fileId: string; version: number; data: TranscriptFile } | null> {
  const video = await db.projectFile.findFirst({ where: { projectId, kind: 'raw_video' }, orderBy: { version: 'desc' } });
  if (!video) return null;
  const t = await loadLatestTranscript(db, projectId);
  return t && t.version === video.version ? t : null;
}
