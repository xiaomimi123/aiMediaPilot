import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFilmBundle } from '@/lib/film/bundle';
import { createFakeDb } from '../../helpers/fake-db';

async function setup(opts: { withTranscript?: boolean } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-fb-'));
  const tPath = path.join(dir, 'transcript.v1.json');
  await fs.writeFile(tPath, JSON.stringify({ lines: [{ startSec: 0, endSec: 2, text: '你好' }], rawLines: [], durationSec: 79.2, proofread: 'done' }));
  const files = [
    { kind: 'raw_video', version: 1, path: path.join(dir, 'raw.v1.mov'), meta: { durationSec: 79.2 } },
    ...(opts.withTranscript === false ? [] : [{ kind: 'transcript', version: 1, path: tPath }]),
    { kind: 'material', version: 1, path: path.join(dir, 'material-a.png'), meta: { note: '讲笨办法时放', originalName: 'u.png', mediaType: 'image' } },
    { kind: 'material', version: 1, path: path.join(dir, 'material-b.mov'), meta: { note: '', originalName: 'rec.mov', mediaType: 'video', durationSec: 40 } },
  ];
  return createFakeDb({ project: { title: 'U盘', stage: 'recorded' }, files });
}
const probe = async () => ({ width: 1258, height: 2246 });

describe('buildFilmBundle', () => {
  it('collects project, transcript, video and materials with absolute paths', async () => {
    const { db } = await setup();
    const b = await buildFilmBundle(db, 'p1', probe);
    expect(b.project).toMatchObject({ id: 'p1', title: 'U盘' });
    expect(b.transcript).toEqual([{ startSec: 0, endSec: 2, text: '你好' }]);
    expect(b.video).toMatchObject({ ext: '.mov', durationSec: 79.2, width: 1258, height: 2246 });
    expect(b.materials.map((m) => [m.mediaType, m.note, m.ext, m.durationSec])).toEqual([
      ['image', '讲笨办法时放', '.png', null],
      ['video', '', '.mov', 40],
    ]);
  });
  it('refuses when the recording has not been transcribed', async () => {
    const { db } = await setup({ withTranscript: false });
    await expect(buildFilmBundle(db, 'p1', probe)).rejects.toThrow('这个项目还没有转写好的口播，先在「口播」一步上传并等转写完成。');
  });
});
