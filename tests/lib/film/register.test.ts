import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerFilm } from '@/lib/film/register';
import { createFakeDb } from '../../helpers/fake-db';

async function filmDir(withMp4 = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-films-'));
  const projRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-proj-'));
  const dir = path.join(root, 'p1-v2');
  await fs.mkdir(path.join(dir, 'out'), { recursive: true });
  await fs.writeFile(path.join(dir, 'data.json'), JSON.stringify({ projectId: 'p1', version: 2 }));
  await fs.writeFile(
    path.join(dir, 'shots.json'),
    JSON.stringify({ version: 1, shots: [
      { id: 'a', fromSec: 0, toSec: 5, intent: '开场' },
      { id: 'b', fromSec: 5, toSec: 12, intent: '录屏', material: { id: 'fm', clipFromSec: 10, clipToSec: 20, speed: 1.5 } },
    ] }),
  );
  if (withMp4) await fs.writeFile(path.join(dir, 'out', 'final.mp4'), 'mp4data');
  process.env.PROJECT_FILES_ROOT = projRoot;
  return { dir, projRoot };
}

describe('registerFilm', () => {
  it('moves the mp4 into the project, records usage, advances the stage and posts a notice', async () => {
    const { dir, projRoot } = await filmDir();
    const { db, files, project, messages } = createFakeDb({ project: { stage: 'recorded' } });
    const r = await registerFilm(db, dir, '按新风格重排了冷知识段');
    expect(r.version).toBe(2);
    const f = files.find((x) => x.kind === 'final_mp4')!;
    expect(f.path).toBe(path.join(projRoot, 'p1', 'final.v2.mp4'));
    expect(await fs.readFile(f.path, 'utf8')).toBe('mp4data');
    expect(f.meta).toMatchObject({
      filmVersion: 2,
      sourceDir: dir,
      summary: '按新风格重排了冷知识段',
      usage: [{ materialId: 'fm', atSec: 5, durSec: 7, clipFromSec: 10, clipToSec: 20, speed: 1.5 }],
    });
    expect(project.stage).toBe('final');
    expect(messages.at(-1)).toMatchObject({ role: 'system', toolName: 'job:film', content: '成片 v2 已生成：按新风格重排了冷知识段', toolResult: { ok: true } });
  });
  it('refuses to register when the mp4 is missing or empty', async () => {
    const { dir } = await filmDir(false);
    const { db, files } = createFakeDb();
    await expect(registerFilm(db, dir, 'x')).rejects.toThrow('没找到成片');
    expect(files).toHaveLength(0);
  });
  it('refuses to register the same film version twice (keeps the old mp4)', async () => {
    const { dir, projRoot } = await filmDir();
    const { db, files } = createFakeDb({ files: [{ kind: 'final_mp4', meta: { filmVersion: 2 } }] });
    await expect(registerFilm(db, dir, '再登记一次')).rejects.toThrow('成片 v2 已经登记过了');
    expect(files.filter((f) => f.kind === 'final_mp4')).toHaveLength(1);
    await expect(fs.access(path.join(projRoot, 'p1', 'final.v2.mp4'))).rejects.toThrow();
  });
});
