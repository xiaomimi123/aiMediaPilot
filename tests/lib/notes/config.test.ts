import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { detectVault, getNotesConfig, saveNotesConfig, listTopFolders, DEFAULT_READ_FOLDERS } from '@/lib/notes/config';
import { makeVault } from './fixture';

function settingsDb() {
  const rows = new Map<string, string>();
  const db = {
    appSetting: {
      findMany: async ({ where }: { where: { key: { in: string[] } } }) => [...rows].filter(([k]) => where.key.in.includes(k)).map(([key, value]) => ({ key, value })),
      upsert: async ({ where, create, update }: { where: { key: string }; create: { value: string }; update: { value: string } }) => void rows.set(where.key, rows.has(where.key) ? update.value : create.value),
    },
  } as unknown as PrismaClient;
  return { db, rows };
}

async function obsidianJson(vaults: Record<string, { path: string; open?: boolean }>) {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mp-obs-')), 'obsidian.json');
  await fs.writeFile(f, JSON.stringify({ vaults }));
  return f;
}

describe('notes config', () => {
  it('detects the open vault from obsidian.json', async () => {
    expect(await detectVault(await obsidianJson({ a: { path: '/x/A' }, b: { path: '/x/B', open: true } }))).toBe('/x/B');
    expect(await detectVault('/nonexistent/obsidian.json')).toBeNull();
  });
  it('falls back to detection and default folders', async () => {
    const { db } = settingsDb();
    expect(await getNotesConfig(db, await obsidianJson({ a: { path: '/x/A' } }))).toEqual({ vault: '/x/A', readFolders: DEFAULT_READ_FOLDERS, detected: true });
  });
  it('saves a valid vault and folders', async () => {
    const v = await makeVault({ '5-灵感/a.md': 'a' });
    const { db } = settingsDb();
    await saveNotesConfig(db, { vault: v, readFolders: ['5-灵感'] });
    expect(await getNotesConfig(db, '/nonexistent')).toEqual({ vault: v, readFolders: ['5-灵感'], detected: false });
  });
  it('rejects a folder without .obsidian and unsafe folder names', async () => {
    const { db } = settingsDb();
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-plain-'));
    await expect(saveNotesConfig(db, { vault: plain })).rejects.toThrow('这个文件夹不是 Obsidian 库');
    await expect(saveNotesConfig(db, { readFolders: ['../外面'] })).rejects.toThrow('文件夹名不对');
    await expect(saveNotesConfig(db, { readFolders: ['.obsidian'] })).rejects.toThrow('文件夹名不对');
  });
  it('lists top-level folders without hidden or underscore ones', async () => {
    const v = await makeVault({ '5-灵感/a.md': 'a', '_模板/t.md': 't', '1-项目/p.md': 'p' });
    expect(await listTopFolders(v)).toEqual(['1-项目', '5-灵感']);
  });
  it('only accepts top-level folders', async () => {
    const { db } = settingsDb();
    await expect(saveNotesConfig(db, { readFolders: ['5-灵感/子目录'] })).rejects.toThrow('文件夹名不对');
  });
});
