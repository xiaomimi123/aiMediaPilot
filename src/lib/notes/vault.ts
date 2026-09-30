import fs from 'node:fs/promises';
import path from 'node:path';
import { checkVault, VAULT_MISSING, WRITE_FOLDER, type NotesConfig } from './config';

export class NotesError extends Error {}
export const MAX_NOTE_CHARS = 6000;
const OUTSIDE = '这篇笔记不在允许读取的文件夹里';

export interface NoteHit {
  path: string;
  title: string;
  snippet: string;
  mtime: string;
}

async function vaultRoot(cfg: NotesConfig): Promise<string> {
  if (!cfg.vault || (await checkVault(cfg.vault))) throw new NotesError(VAULT_MISSING);
  return fs.realpath(cfg.vault);
}

const roots = (cfg: NotesConfig) => [...new Set([...cfg.readFolders, WRITE_FOLDER])];
const toPosix = (p: string) => p.split(path.sep).join('/');

/** 相对路径 → 绝对路径; 必须是可读文件夹里、非隐藏、非符号链接的 .md */
export async function resolveReadable(cfg: NotesConfig, rel: string): Promise<string> {
  const vault = await vaultRoot(cfg);
  const full = path.resolve(vault, rel);
  const inside = path.relative(vault, full);
  const segs = inside.split(path.sep);
  if (inside.startsWith('..') || path.isAbsolute(inside) || segs.some((s) => s.startsWith('.')) || !full.endsWith('.md')) throw new NotesError(OUTSIDE);
  if (!roots(cfg).some((r) => inside === r || inside.startsWith(r + path.sep))) throw new NotesError(OUTSIDE);
  const lst = await fs.lstat(full).catch(() => null);
  if (!lst) throw new NotesError(`找不到这篇笔记：${rel}`);
  if (lst.isSymbolicLink()) throw new NotesError(OUTSIDE);
  // 中间目录也不能是符号链接
  if ((await fs.realpath(full)) !== full) throw new NotesError(OUTSIDE);
  return full;
}

async function walk(dir: string, out: string[]) {
  const es = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of es) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
}

export async function listReadableNotes(cfg: NotesConfig): Promise<string[]> {
  const vault = await vaultRoot(cfg);
  const out: string[] = [];
  for (const r of roots(cfg)) {
    const dir = path.join(vault, r);
    const st = await fs.lstat(dir).catch(() => null);
    if (st?.isDirectory()) await walk(dir, out);
  }
  return out.map((p) => toPosix(path.relative(vault, p)));
}

const cache = new Map<string, { mtimeMs: number; text: string }>();
async function readCached(full: string): Promise<{ text: string; mtime: Date }> {
  const st = await fs.stat(full);
  const c = cache.get(full);
  if (c && c.mtimeMs === st.mtimeMs) return { text: c.text, mtime: st.mtime };
  const text = await fs.readFile(full, 'utf8');
  cache.set(full, { mtimeMs: st.mtimeMs, text });
  return { text, mtime: st.mtime };
}

function splitFrontmatter(text: string): { front: string; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  return m ? { front: m[1], body: text.slice(m[0].length) } : { front: '', body: text };
}

const countOf = (hay: string, w: string) => (w ? hay.split(w).length - 1 : 0);

export async function searchNotes(cfg: NotesConfig, query: string, limit = 8): Promise<NoteHit[]> {
  const vault = await vaultRoot(cfg);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: (NoteHit & { score: number; t: number })[] = [];
  for (const rel of await listReadableNotes(cfg)) {
    const { text, mtime } = await readCached(path.join(vault, rel));
    const title = path.basename(rel, '.md');
    const { front, body } = splitFrontmatter(text);
    const tags = [...body.matchAll(/(^|\s)#([^\s#]+)/g)].map((m) => m[2]).join(' ');
    const [lt, lf, lb] = [title.toLowerCase(), `${front}\n${tags}`.toLowerCase(), body.toLowerCase()];
    let score = 0;
    for (const w of words) score += (lt.includes(w) ? 5 : 0) + (lf.includes(w) ? 3 : 0) + Math.min(countOf(lb, w), 5);
    if (score === 0) continue;
    const at = Math.min(...words.map((w) => lb.indexOf(w)).filter((i) => i >= 0), Infinity);
    const start = at === Infinity ? 0 : Math.max(0, at - 40);
    scored.push({ path: rel, title, snippet: body.slice(start, start + 120).replace(/\s+/g, ' ').trim(), mtime: mtime.toISOString(), score, t: mtime.getTime() });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.t - a.t)
    .slice(0, limit)
    .map(({ score: _s, t: _t, ...h }) => h);
}

export async function readNote(cfg: NotesConfig, rel: string): Promise<{ path: string; title: string; text: string }> {
  const full = await resolveReadable(cfg, rel);
  const { text } = await readCached(full);
  const out = text.length > MAX_NOTE_CHARS ? `${text.slice(0, MAX_NOTE_CHARS)}\n（已截断，全文 ${text.length} 字）` : text;
  return { path: toPosix(rel), title: path.basename(rel, '.md'), text: out };
}
