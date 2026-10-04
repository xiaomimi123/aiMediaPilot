import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deleteFilm, DELETED_FILM_KIND } from '@/lib/film/delete';
import { nextFilmVersion } from '@/lib/film/scaffold';
import { createFakeDb } from '../../helpers/fake-db';

async function setup(version = 1, sessions: { projectId: string; status: string; filmDir?: string | null; baseFilmDir?: string | null }[] = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
  const proj = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-proj-'));
  const dir = path.join(root, `p1-v${version}`);
  await fs.mkdir(path.join(dir, 'public'), { recursive: true });
  await fs.writeFile(path.join(dir, 'Film.tsx'), 'x');
  const mp4 = path.join(proj, `final.v${version}.mp4`);
  await fs.writeFile(mp4, 'mp4');
  const { db, files } = createFakeDb({
    files: [{ id: 'ff', projectId: 'p1', kind: 'final_mp4', path: mp4, meta: { filmVersion: version, sourceDir: dir } }],
    filmSessions: sessions,
  });
  return { db, files, root, dir, mp4 };
}
const exists = (p: string) => fs.access(p).then(() => true, () => false);

describe('deleteFilm', () => {
  it('removes the video and the film dir and marks the version deleted', async () => {
    const { db, files, root, dir, mp4 } = await setup(1);
    expect(await deleteFilm(db, 'p1', 'ff', root)).toEqual({ version: 1 });
    expect(await exists(mp4)).toBe(false);
    expect(await exists(dir)).toBe(false);
    expect(files[0].kind).toBe(DELETED_FILM_KIND);
  });
  it('never reuses a deleted version number', async () => {
    const { db, root } = await setup(4);
    await deleteFilm(db, 'p1', 'ff', root);
    expect(await nextFilmVersion(db, 'p1', root)).toBe(5);
  });
  it('leaves a film dir whose recorded path does not match this project and version', async () => {
    const { db, files, root, dir } = await setup(2);
    (files[0].meta as { sourceDir: string }).sourceDir = path.join(root, 'p1-v3');
    await deleteFilm(db, 'p1', 'ff', root);
    expect(await exists(dir)).toBe(true);
    expect(files[0].kind).toBe(DELETED_FILM_KIND);
  });
  it('refuses while a film session is based on or producing this version', async () => {
    for (const s of [
      { projectId: 'p1', status: 'waiting', baseFilmDir: 'remotion/films/p1-v1' },
      { projectId: 'p1', status: 'failed', filmDir: 'remotion/films/p1-v1' },
    ]) {
      const { db, files, mp4 } = await setup(1, [s]);
      await expect(deleteFilm(db, 'p1', 'ff', os.tmpdir())).rejects.toThrow('正在基于它出片，先结束那次出片再删');
      expect(await exists(mp4)).toBe(true);
      expect(files[0].kind).toBe('final_mp4');
    }
  });
  it('refuses an unknown or already deleted film', async () => {
    const { db, root } = await setup(1);
    await deleteFilm(db, 'p1', 'ff', root);
    await expect(deleteFilm(db, 'p1', 'ff', root)).rejects.toThrow('成片不存在或已删除');
    await expect(deleteFilm(db, 'p2', 'ff', root)).rejects.toThrow('成片不存在或已删除');
  });
});
