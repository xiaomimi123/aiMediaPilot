import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nextFilmVersion, scaffoldFilm } from '@/lib/film/scaffold';
import type { FilmBundle } from '@/lib/film/bundle';
import { createFakeDb } from '../../helpers/fake-db';

async function bundleIn(dir: string): Promise<FilmBundle> {
  const video = path.join(dir, 'raw.v1.mov');
  const img = path.join(dir, 'material-a.png');
  await fs.writeFile(video, 'v');
  await fs.writeFile(img, 'i');
  return {
    project: { id: 'p1', title: 'U盘', stage: 'recorded', targetSec: 60 },
    script: null,
    transcript: [
      { startSec: 0, endSec: 3.2, text: '第一句' },
      { startSec: 3.2, endSec: 7, text: '第二句' },
    ],
    video: { path: video, ext: '.mov', durationSec: 7, width: 1080, height: 1920 },
    materials: [{ id: 'fa', path: img, ext: '.png', mediaType: 'image', note: '放这', originalName: 'u.png', durationSec: null }],
  };
}

describe('nextFilmVersion', () => {
  it('is one past the highest registered film', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    const { db } = createFakeDb({ files: [{ kind: 'final_mp4', meta: { filmVersion: 2 } }] });
    expect(await nextFilmVersion(db, 'p1', root)).toBe(3);
  });
  it('skips versions whose directory already exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    await fs.mkdir(path.join(root, 'p1-v1'));
    const { db } = createFakeDb();
    expect(await nextFilmVersion(db, 'p1', root)).toBe(2);
  });
});

describe('scaffoldFilm', () => {
  it('creates data.json, linked media, entry files and a shot per transcript line', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-src-'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    const filmDir = await scaffoldFilm(await bundleIn(dir), 1, root);
    expect(filmDir).toBe(path.join(root, 'p1-v1'));
    const data = JSON.parse(await fs.readFile(path.join(filmDir, 'data.json'), 'utf8'));
    expect(data).toMatchObject({ projectId: 'p1', version: 1, durationSec: 7, video: 'raw.mov' });
    expect(data.materials[0]).toMatchObject({ id: 'fa', file: 'm-fa.png', mediaType: 'image', note: '放这' });
    expect(await fs.readFile(path.join(filmDir, 'public', 'raw.mov'), 'utf8')).toBe('v');
    expect(await fs.readFile(path.join(filmDir, 'public', 'm-fa.png'), 'utf8')).toBe('i');
    for (const f of ['index.tsx', 'Film.tsx', 'copy.ts']) await expect(fs.access(path.join(filmDir, f))).resolves.toBeUndefined();
    const shots = JSON.parse(await fs.readFile(path.join(filmDir, 'shots.json'), 'utf8'));
    expect(shots.shots.map((s: { fromSec: number; toSec: number }) => [s.fromSec, s.toSec])).toEqual([
      [0, 3.2],
      [3.2, 7],
    ]);
  });
  it('refuses to overwrite an existing film directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-src-'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    await fs.mkdir(path.join(root, 'p1-v1'));
    await expect(scaffoldFilm(await bundleIn(dir), 1, root)).rejects.toThrow('片子目录已存在');
  });

  it('merges lines shorter than 2 seconds so the skeleton passes film check', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-src-'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    const b = await bundleIn(dir);
    b.transcript = [
      { startSec: 0, endSec: 1.2, text: '先说背景' },
      { startSec: 1.2, endSec: 4, text: '去年我盯了一个赛道' },
      { startSec: 4, endSec: 4.9, text: '我当时就在想' },
      { startSec: 4.9, endSec: 7, text: '这事有救' },
    ];
    const filmDir = await scaffoldFilm(b, 1, root);
    const shots = JSON.parse(await fs.readFile(path.join(filmDir, 'shots.json'), 'utf8'));
    expect(shots.shots.map((s: { fromSec: number; toSec: number }) => [s.fromSec, s.toSec])).toEqual([
      [0, 4.9],
      [4.9, 7],
    ]);
  });

  it('skips a material whose file is gone and records it, instead of crashing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-src-'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    const b = await bundleIn(dir);
    b.materials.push({ id: 'gone', path: path.join(dir, 'nope.png'), ext: '.png', mediaType: 'image', note: '', originalName: '丢了.png', durationSec: null });
    const filmDir = await scaffoldFilm(b, 1, root);
    const data = JSON.parse(await fs.readFile(path.join(filmDir, 'data.json'), 'utf8'));
    expect(data.materials.map((m: { id: string }) => m.id)).toEqual(['fa']);
    expect(data.missingMaterials).toEqual([{ id: 'gone', originalName: '丢了.png' }]);
  });
  it('fails in Chinese without leaving a half-built directory when the recording file is gone', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-src-'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    const b = await bundleIn(dir);
    await fs.unlink(b.video!.path);
    await expect(scaffoldFilm(b, 1, root)).rejects.toThrow('口播原片文件不在了');
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('writes a landscape film when asked and leaves portrait output unchanged', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-src-'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
    const land = await scaffoldFilm(await bundleIn(dir), 1, root, { orientation: 'landscape' });
    expect(JSON.parse(await fs.readFile(path.join(land, 'data.json'), 'utf8')).orientation).toBe('landscape');
    const idx = await fs.readFile(path.join(land, 'index.tsx'), 'utf8');
    expect(idx).toContain('<OrientationProvider value="landscape">');
    expect(idx).toContain('width={LAYOUT.landscape.W} height={LAYOUT.landscape.H}');
    const por = await scaffoldFilm(await bundleIn(dir), 2, root);
    expect('orientation' in JSON.parse(await fs.readFile(path.join(por, 'data.json'), 'utf8'))).toBe(false);
    expect(await fs.readFile(path.join(por, 'index.tsx'), 'utf8')).toContain('width={W} height={H}');
    expect(await fs.readFile(path.join(por, 'index.tsx'), 'utf8')).not.toContain('OrientationProvider');
  });
});
