import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { checkVault, getNotesConfig, listTopFolders, saveNotesConfig, WRITE_FOLDER } from '@/lib/notes/config';
import { listReadableNotes } from '@/lib/notes/vault';

export const dynamic = 'force-dynamic';

export interface NotesSettingsView {
  vault: string | null;
  detected: boolean;
  vaultProblem: string | null;
  readFolders: string[];
  topFolders: string[];
  missing: string[];
  writeFolder: string;
  noteCount: number | null;
}

async function view(): Promise<NotesSettingsView> {
  const cfg = await getNotesConfig(prisma);
  const vaultProblem = cfg.vault ? await checkVault(cfg.vault) : '没找到 Obsidian 库：填库路径';
  const topFolders = cfg.vault && !vaultProblem ? await listTopFolders(cfg.vault) : [];
  const missing: string[] = [];
  if (cfg.vault && !vaultProblem) for (const f of cfg.readFolders) if (!(await fs.stat(path.join(cfg.vault, f)).catch(() => null))) missing.push(f);
  const noteCount = vaultProblem ? null : (await listReadableNotes(cfg).catch(() => [])).length;
  return { vault: cfg.vault, detected: cfg.detected, vaultProblem, readFolders: cfg.readFolders, topFolders, missing, writeFolder: WRITE_FOLDER, noteCount };
}

export async function GET() {
  return ok(await view());
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { vault?: unknown; readFolders?: unknown };
  const vault = typeof body.vault === 'string' ? body.vault.trim() : undefined;
  const readFolders = Array.isArray(body.readFolders) && body.readFolders.every((f) => typeof f === 'string') ? (body.readFolders as string[]) : undefined;
  try {
    await saveNotesConfig(prisma, { vault, readFolders });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 400);
  }
  return ok(await view());
}
