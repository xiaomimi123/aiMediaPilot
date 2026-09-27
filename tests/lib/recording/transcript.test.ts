import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadLatestTranscript } from '@/lib/recording/transcript';
import { createFakeDb } from '../../helpers/fake-db';

describe('loadLatestTranscript', () => {
  it('reads the newest transcript file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-tr-'));
    const p = path.join(dir, 'transcript.v2.json');
    await fs.writeFile(p, JSON.stringify({ lines: [{ startSec: 0, endSec: 1, text: '你好' }], rawLines: [], durationSec: 1, proofread: 'done' }));
    const { db } = createFakeDb({ files: [{ kind: 'transcript', path: '/nope', version: 1 }, { kind: 'transcript', path: p, version: 2 }] });
    const t = await loadLatestTranscript(db, 'p1');
    expect(t?.version).toBe(2);
    expect(t?.data.lines[0].text).toBe('你好');
  });
  it('returns null when the file is missing on disk', async () => {
    const { db } = createFakeDb({ files: [{ kind: 'transcript', path: '/definitely/missing.json', version: 1 }] });
    expect(await loadLatestTranscript(db, 'p1')).toBeNull();
  });
});
