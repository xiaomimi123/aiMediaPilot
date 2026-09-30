import fs from 'node:fs/promises';
import path from 'node:path';
import { checkVault, VAULT_MISSING, WRITE_FOLDER, type NotesConfig } from './config';
import { NotesError } from './vault';

export const START = '<!-- mediapilot:start -->';
export const END = '<!-- mediapilot:end -->';

export interface NoteSource {
  projectId: string;
  title: string;
  stage: string;
  topic: string | null;
  benchmark: { author: string; digg: number; ratio: number | null; url: string } | null;
  segments: { label: string; text: string }[];
  retro: { dayN: number; viewCount: number | null; likeCount: number | null; stages: { label: string; verdict: string; note: string }[]; narrative: string | null } | null;
  pastRetroBlocks: string[];
  lessons: { text: string; status: string }[];
  summary: string | null;
}

const V: Record<string, string> = { bad: '差', good: '好', even: '平', na: '—' };
const L: Record<string, string> = { active: '已采纳', candidate: '待决定', rejected: '不要', retired: '已停用' };
const n = (v: number | null) => (v === null ? '—' : v.toLocaleString('en-US'));

export function noteFileName(title: string): string {
  const safe = title.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || '未命名项目';
  return `${WRITE_FOLDER}/项目/${safe}.md`;
}

const dayOf = (block: string) => Number(/^### 第 (\d+) 天/.exec(block)?.[1] ?? 0);

/** 区块里「## 复盘」下的每个「### 第 N 天」小节 */
export function retroBlocks(region: string): string[] {
  const m = /## 复盘\n([\s\S]*?)(?=\n## |$)/.exec(region);
  if (!m) return [];
  return m[1].split(/\n(?=### 第 \d+ 天)/).map((s) => s.trim()).filter((s) => /^### 第 \d+ 天/.test(s));
}

export function buildRegion(src: NoteSource): string {
  const parts = [`# ${src.title}`, `## 选题\n${src.topic ?? src.title}`];
  if (src.benchmark) {
    const b = src.benchmark;
    parts.push(`## 对标\n${b.author} · ${n(b.digg)} 赞${b.ratio ? `（平时的 ${b.ratio} 倍）` : ''} · ${b.url}`);
  }
  if (src.segments.length) parts.push(`## 定稿\n${src.segments.map((s) => `### ${s.label}\n${s.text}`).join('\n\n')}`);
  const blocks = src.pastRetroBlocks.filter((b) => !src.retro || dayOf(b) !== src.retro.dayN);
  if (src.retro) {
    const r = src.retro;
    blocks.push(
      [`### 第 ${r.dayN} 天 · 播放 ${n(r.viewCount)} · 点赞 ${n(r.likeCount)}`, ...r.stages.map((s) => `- ${V[s.verdict] ?? '—'} ${s.label}：${s.note}`), r.narrative ? `编导解读：${r.narrative}` : '']
        .filter(Boolean)
        .join('\n'),
    );
  }
  if (blocks.length) parts.push(`## 复盘\n${blocks.sort((a, b) => dayOf(a) - dayOf(b)).join('\n\n')}`);
  if (src.lessons.length) parts.push(`## 写法经验\n${src.lessons.map((l) => `- ${l.text}（${L[l.status] ?? l.status}）`).join('\n')}`);
  if (src.summary) parts.push(`## 编导小结\n${src.summary}`);
  return parts.join('\n\n');
}

const FRONT = /^---\n([\s\S]*?)\n---\n?/;

export function ownerOf(file: string): string | null {
  if (!file.includes(START) || !file.includes(END)) return null;
  return /^mediapilot_id:\s*(\S+)/m.exec(FRONT.exec(file)?.[1] ?? '')?.[1] ?? null;
}

export function renderFile(existing: string | null, meta: { projectId: string; stage: string; today: string }, region: string): string {
  const block = `${START}\n${region}\n${END}`;
  if (!existing || !existing.includes(START) || !existing.includes(END)) {
    return `---\nmediapilot_id: ${meta.projectId}\nstage: ${meta.stage}\nupdated: ${meta.today}\ntags: [mediapilot]\n---\n${block}\n`;
  }
  const replaced = existing.slice(0, existing.indexOf(START)) + block + existing.slice(existing.indexOf(END) + END.length);
  return replaced.replace(FRONT, (fm) => fm.replace(/^stage:.*$/m, `stage: ${meta.stage}`).replace(/^updated:.*$/m, `updated: ${meta.today}`));
}

const readOrNull = (p: string) => fs.readFile(p, 'utf8').catch(() => null);

export async function writeProjectNote(cfg: NotesConfig, relPath: string, meta: { projectId: string; stage: string; today: string }, region: string): Promise<string> {
  if (!cfg.vault || (await checkVault(cfg.vault))) throw new NotesError(VAULT_MISSING);
  const norm = path.posix.normalize(relPath);
  if (!norm.startsWith(`${WRITE_FOLDER}/`) || norm.includes('..') || !norm.endsWith('.md')) throw new NotesError('只能写进 MediaPilot 文件夹');
  let rel = norm;
  let existing = await readOrNull(path.join(cfg.vault, rel));
  // 同名文件属于别人(用户手建或别的项目): 换带项目 id 的文件名, 不动原文件
  if (existing !== null && ownerOf(existing) !== meta.projectId) {
    rel = norm.replace(/\.md$/, `-${meta.projectId.slice(-6)}.md`);
    existing = await readOrNull(path.join(cfg.vault, rel));
    if (existing !== null && ownerOf(existing) !== meta.projectId) throw new NotesError(`${rel} 已经有别的笔记，没有覆盖`);
  }
  const full = path.join(cfg.vault, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.mp-tmp`;
  await fs.writeFile(tmp, renderFile(existing, meta, region));
  await fs.rename(tmp, full);
  return rel;
}
