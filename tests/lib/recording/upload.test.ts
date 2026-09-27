import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { finalizeUpload } from '@/lib/recording/upload';
import { createFakeDb } from '../../helpers/fake-db';

async function temp(dir: string, name: string) {
  const p = path.join(dir, name);
  await fs.writeFile(p, name);
  return p;
}
const meta = { originalName: 'a.mov', sizeBytes: 1, durationSec: 1 };
const run = () => new Promise<{ notice: string }>(() => {}); // 永不结束: 模拟转写一直在跑

describe('finalizeUpload', () => {
  it('assigns the next version, renames the temp file, records it and starts transcription', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-up-'));
    const { db, files, jobs } = createFakeDb({ files: [{ kind: 'raw_video', version: 1, path: path.join(dir, 'raw.v1.mov') }] });
    const r = await finalizeUpload(db, { projectId: 'p1', tempPath: await temp(dir, 'up-1.part'), ext: '.mov', meta, run });
    expect(r.ok).toBe(true);
    expect(files.at(-1)).toMatchObject({ version: 2, path: path.join(dir, 'raw.v2.mov') });
    await expect(fs.access(path.join(dir, 'raw.v2.mov'))).resolves.toBeUndefined();
    expect(jobs).toHaveLength(1);
  });

  it('two simultaneous uploads: the second is refused and its temp file removed, no version collision', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-up-'));
    const { db, files, jobs } = createFakeDb();
    const t1 = await temp(dir, 'up-1.part');
    const t2 = await temp(dir, 'up-2.part');
    const [a, b] = await Promise.all([
      finalizeUpload(db, { projectId: 'p1', tempPath: t1, ext: '.mov', meta, run }),
      finalizeUpload(db, { projectId: 'p1', tempPath: t2, ext: '.mov', meta, run }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(files.filter((f) => f.kind === 'raw_video')).toHaveLength(1);
    expect(jobs).toHaveLength(1);
    const refused = a.ok ? b : a;
    expect(refused).toMatchObject({ ok: false, message: '上一个视频还在转写，等它完成再传。' });
    expect((await fs.readdir(dir)).filter((n) => n.endsWith('.part'))).toEqual([]);
  });
});
