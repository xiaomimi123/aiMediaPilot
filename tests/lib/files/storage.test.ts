import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { projectDir, versionedName, audioName, videoExt, saveStreamToFile } from '@/lib/files/storage';

describe('storage names', () => {
  it('builds versioned names per kind', () => {
    expect(versionedName('raw_video', 2, '.mov')).toBe('raw.v2.mov');
    expect(versionedName('transcript', 1, '.json')).toBe('transcript.v1.json');
    expect(audioName(3)).toBe('audio.v3.wav');
  });
  it('rejects project ids that could escape the root', () => {
    expect(() => projectDir('../etc')).toThrow('非法项目编号');
    expect(projectDir('cmuabc123')).toMatch(/cmuabc123$/);
  });
  it('accepts only mp4/mov/m4v, case-insensitive', () => {
    expect(videoExt('口播.MOV')).toBe('.mov');
    expect(videoExt('a.mp4')).toBe('.mp4');
    expect(videoExt('a.avi')).toBeNull();
    expect(videoExt('noext')).toBeNull();
  });
});

describe('saveStreamToFile', () => {
  it('writes the stream and returns the byte count', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-store-'));
    const dest = path.join(dir, 'raw.v1.mp4');
    const n = await saveStreamToFile(Readable.from([Buffer.from('abc'), Buffer.from('de')]), dest);
    expect(n).toBe(5);
    expect(await fs.readFile(dest, 'utf8')).toBe('abcde');
  });
  it('removes the partial file when the stream errors', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-store-'));
    const dest = path.join(dir, 'raw.v1.mp4');
    const broken = new Readable({
      read() {
        this.push(Buffer.from('half'));
        this.destroy(new Error('connection reset'));
      },
    });
    await expect(saveStreamToFile(broken, dest)).rejects.toThrow('connection reset');
    await expect(fs.access(dest)).rejects.toThrow();
  });
});
