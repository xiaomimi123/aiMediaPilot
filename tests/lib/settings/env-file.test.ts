import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { upsertEnvLine, writeEnvKey } from '@/lib/settings/env-file';

describe('upsertEnvLine', () => {
  it('replaces an existing line and keeps the others', () => {
    expect(upsertEnvLine('A=1\nDEEPSEEK_API_KEY=old\n# 注释\nB=2\n', 'DEEPSEEK_API_KEY', 'new')).toBe('A=1\nDEEPSEEK_API_KEY=new\n# 注释\nB=2\n');
  });
  it('appends when the key is missing, even without a trailing newline', () => {
    expect(upsertEnvLine('A=1', 'DEEPSEEK_API_KEY', 'k')).toBe('A=1\nDEEPSEEK_API_KEY=k\n');
  });
  it('does not touch a commented-out line with the same name', () => {
    expect(upsertEnvLine('# DEEPSEEK_API_KEY=x\n', 'DEEPSEEK_API_KEY', 'k')).toBe('# DEEPSEEK_API_KEY=x\nDEEPSEEK_API_KEY=k\n');
  });
});

describe('writeEnvKey', () => {
  it('writes the file and updates process.env', async () => {
    const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mp-env-')), '.env');
    await fs.writeFile(f, 'A=1\n');
    await writeEnvKey('MP_TEST_KEY', 'v1', f);
    expect(await fs.readFile(f, 'utf8')).toBe('A=1\nMP_TEST_KEY=v1\n');
    expect(process.env.MP_TEST_KEY).toBe('v1');
  });
});
