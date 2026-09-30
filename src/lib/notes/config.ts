import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

export const DEFAULT_READ_FOLDERS = ['5-灵感', '3-资源', '1-项目'];
export const WRITE_FOLDER = 'MediaPilot';
export const VAULT_MISSING = '没找到 Obsidian 库：去设置页填库路径';
export const OBSIDIAN_CONFIG = path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json');
const K_VAULT = 'obsidian.vault';
const K_FOLDERS = 'obsidian.readFolders';

export interface NotesConfig {
  vault: string | null;
  readFolders: string[];
}

/** Obsidian 自己记录的库; 优先当前打开的那个 */
export async function detectVault(configPath = OBSIDIAN_CONFIG): Promise<string | null> {
  try {
    const j = JSON.parse(await fs.readFile(configPath, 'utf8')) as { vaults?: Record<string, { path?: string; open?: boolean }> };
    const vs = Object.values(j.vaults ?? {}).filter((v) => typeof v.path === 'string');
    return (vs.find((v) => v.open) ?? vs[0])?.path ?? null;
  } catch {
    return null;
  }
}

export async function checkVault(vault: string): Promise<string | null> {
  const st = await fs.stat(vault).catch(() => null);
  if (!st?.isDirectory()) return '找不到这个文件夹';
  if (!(await fs.stat(path.join(vault, '.obsidian')).catch(() => null))) return '这个文件夹不是 Obsidian 库（里面没有 .obsidian）';
  return null;
}

export async function listTopFolders(vault: string): Promise<string[]> {
  const es = await fs.readdir(vault, { withFileTypes: true }).catch(() => []);
  return es.filter((e) => e.isDirectory() && !/^[._]/.test(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b));
}

export async function getNotesConfig(db: PrismaClient, configPath?: string): Promise<NotesConfig & { detected: boolean }> {
  const rows = await db.appSetting.findMany({ where: { key: { in: [K_VAULT, K_FOLDERS] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  let readFolders = DEFAULT_READ_FOLDERS;
  try {
    const raw = get(K_FOLDERS);
    if (raw) readFolders = z.array(z.string()).parse(JSON.parse(raw));
  } catch {
    // 坏值按默认
  }
  const saved = get(K_VAULT);
  if (saved) return { vault: saved, readFolders, detected: false };
  return { vault: await detectVault(configPath), readFolders, detected: true };
}

// 只允许库的顶层文件夹(与设置页一致); 嵌套路径可能穿过符号链接
const badFolder = (f: string) => !f || path.isAbsolute(f) || /[\\/]/.test(f) || f === '..' || f.startsWith('.');

export async function saveNotesConfig(db: PrismaClient, input: { vault?: string; readFolders?: string[] }): Promise<void> {
  if (input.vault !== undefined) {
    const problem = await checkVault(input.vault);
    if (problem) throw new Error(problem);
    await db.appSetting.upsert({ where: { key: K_VAULT }, create: { key: K_VAULT, value: input.vault }, update: { value: input.vault } });
  }
  if (input.readFolders !== undefined) {
    if (input.readFolders.some(badFolder)) throw new Error('文件夹名不对：只能选库里的文件夹');
    const value = JSON.stringify(input.readFolders);
    await db.appSetting.upsert({ where: { key: K_FOLDERS }, create: { key: K_FOLDERS, value }, update: { value } });
  }
}
