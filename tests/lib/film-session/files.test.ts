import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSessionFile } from '@/lib/film-session/files';

describe('session files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-film-'));
  fs.mkdirSync(path.join(dir, 'stills'));
  fs.writeFileSync(path.join(dir, 'stills', '1.2.png'), 'x');
  fs.writeFileSync(path.join(dir, 'stills', '3.jpg'), 'x');
  fs.mkdirSync(path.join(dir, 'out'));
  fs.writeFileSync(path.join(dir, 'out', 'final.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'Film.tsx'), 'x');
  it('serves pngs and mp4s inside the film dir', () => {
    expect(resolveSessionFile(dir, 'stills/1.2.png')).toBe(path.join(dir, 'stills', '1.2.png'));
    expect(resolveSessionFile(dir, 'stills/3.jpg')).toBe(path.join(dir, 'stills', '3.jpg'));
    expect(resolveSessionFile(dir, 'out/final.mp4')).toBe(path.join(dir, 'out', 'final.mp4'));
  });
  it('refuses paths outside the session film dir', () => {
    expect(resolveSessionFile(dir, '../x.png')).toBeNull();
    expect(resolveSessionFile(dir, '/etc/passwd')).toBeNull();
    expect(resolveSessionFile(dir, 'Film.tsx')).toBeNull();
    expect(resolveSessionFile(dir, 'stills/missing.png')).toBeNull();
  });
});
