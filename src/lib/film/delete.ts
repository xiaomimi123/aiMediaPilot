import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { filmsRoot } from './scaffold';

/** 删掉的版本不真删行, 改成这个类型: nextFilmVersion 仍算上它, 版本号不会被重复使用 */
export const DELETED_FILM_KIND = 'final_mp4_deleted';

export class FilmInUse extends Error {}

/** 删除一个成片版本: 成片视频 + 片子目录(只删 <root>/<项目>-v<N>, 登记的路径对不上就不删) */
export async function deleteFilm(db: PrismaClient, projectId: string, fileId: string, root = filmsRoot()): Promise<{ version: number }> {
  const f = await db.projectFile.findFirst({ where: { id: fileId, projectId, kind: 'final_mp4' } });
  if (!f) throw new Error('成片不存在或已删除');
  const meta = (f.meta ?? {}) as { filmVersion?: unknown; sourceDir?: unknown };
  const version = Number(meta.filmVersion) || 0;
  const rel = `remotion/films/${projectId}-v${version}`;
  // 还没结束的出片正基于它改、或正在生成它: 不许删
  const busy = await db.filmSession.findFirst({
    where: { projectId, status: { in: ['running', 'waiting', 'failed', 'stopped'] }, OR: [{ filmDir: rel }, { baseFilmDir: rel }] },
  });
  if (busy) throw new FilmInUse('正在基于它出片，先结束那次出片再删');
  if (/^final\.v\d+\.mp4$/.test(path.basename(f.path))) await fs.unlink(f.path).catch(() => {});
  const dir = path.resolve(root, `${projectId}-v${version}`);
  if (typeof meta.sourceDir === 'string' && path.resolve(meta.sourceDir) === dir) await fs.rm(dir, { recursive: true, force: true });
  await db.projectFile.update({ where: { id: f.id }, data: { kind: DELETED_FILM_KIND } });
  return { version };
}
