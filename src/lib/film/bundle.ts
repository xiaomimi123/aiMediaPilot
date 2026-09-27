import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { ScriptSchema, type Script } from '@/lib/script/model';
import { loadCurrentTranscript } from '@/lib/recording/transcript';
import { probeVideoDimensions } from '@/lib/video/ffmpeg';

export interface FilmBundle {
  project: { id: string; title: string; stage: string; targetSec: number };
  script: Script | null;
  transcript: { startSec: number; endSec: number; text: string }[];
  video: { path: string; ext: string; durationSec: number; width: number; height: number } | null;
  materials: { id: string; path: string; ext: string; mediaType: 'image' | 'video'; note: string; originalName: string; durationSec: number | null }[];
}

type Meta = { durationSec?: unknown; note?: unknown; originalName?: unknown; mediaType?: unknown };

/** 出片用的资料包: 稿子、当前版本的逐句转写、口播原片、素材(绝对路径 + 说明)。 */
export async function buildFilmBundle(
  db: PrismaClient,
  projectId: string,
  probe: (p: string) => Promise<{ width: number; height: number }> = probeVideoDimensions,
): Promise<FilmBundle> {
  const p = await db.project.findUnique({ where: { id: projectId } });
  if (!p) throw new Error(`没有编号为 ${projectId} 的项目`);
  const t = await loadCurrentTranscript(db, projectId);
  if (!t) throw new Error('这个项目还没有转写好的口播，先在「② 口播」上传并等转写完成。');
  const video = await db.projectFile.findFirst({ where: { projectId, kind: 'raw_video' }, orderBy: { version: 'desc' } });
  const materials = await db.projectFile.findMany({ where: { projectId, kind: 'material' }, orderBy: { createdAt: 'asc' } });
  const parsed = ScriptSchema.safeParse(p.script);

  let v: FilmBundle['video'] = null;
  if (video) {
    const meta = (video.meta ?? {}) as Meta;
    const dims = await probe(video.path);
    v = {
      path: video.path,
      ext: path.extname(video.path).toLowerCase(),
      durationSec: typeof meta.durationSec === 'number' ? meta.durationSec : t.data.durationSec,
      width: dims.width,
      height: dims.height,
    };
  }
  return {
    project: { id: p.id, title: p.title, stage: p.stage, targetSec: p.targetSec },
    script: parsed.success ? parsed.data : null,
    transcript: t.data.lines.map((l) => ({ startSec: l.startSec, endSec: l.endSec, text: l.text })),
    video: v,
    materials: materials.map((m) => {
      const meta = (m.meta ?? {}) as Meta;
      return {
        id: m.id,
        path: m.path,
        ext: path.extname(m.path).toLowerCase(),
        mediaType: meta.mediaType === 'video' ? 'video' : 'image',
        note: typeof meta.note === 'string' ? meta.note : '',
        originalName: typeof meta.originalName === 'string' ? meta.originalName : path.basename(m.path),
        durationSec: typeof meta.durationSec === 'number' ? meta.durationSec : null,
      };
    }),
  };
}
