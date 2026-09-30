import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { takeSearchQuota, SEARCH_DAILY_LIMIT } from '@/lib/benchmark/quota';

describe('takeSearchQuota', () => {
  it('allows 10 searches a day and resets the next day', async () => {
    const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mp-q-')), 'q.json');
    const d1 = new Date('2026-09-28T03:00:00Z');
    for (let i = 0; i < SEARCH_DAILY_LIMIT; i++) expect(await takeSearchQuota(f, d1)).toBe(true);
    expect(await takeSearchQuota(f, d1)).toBe(false);
    expect(await takeSearchQuota(f, new Date('2026-09-29T03:00:00Z'))).toBe(true);
  });
});
