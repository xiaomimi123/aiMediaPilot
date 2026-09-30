import type { PrismaClient } from '@prisma/client';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { buildRegion, noteFileName, retroBlocks, writeProjectNote, type NoteSource } from './note';
import type { NotesConfig } from './config';

export const PROPOSAL_PROMPT = '要把这个项目存进 Obsidian 吗？';
export type ProposalTrigger = 'finalize' | 'retro' | 'manual';
export class ProposalConflict extends Error {}

export interface ProposalView {
  id: string;
  projectId: string;
  trigger: string;
  path: string;
  content: string;
  status: string;
  error: string | null;
  createdAt: string;
}

export const toProposalView = (r: { id: string; projectId: string; trigger: string; path: string; content: string; status: string; error: string | null; createdAt: Date }): ProposalView => ({
  id: r.id,
  projectId: r.projectId,
  trigger: r.trigger,
  path: r.path,
  content: r.content,
  status: r.status,
  error: r.error,
  createdAt: r.createdAt.toISOString(),
});

export const pastBlocksFrom = (content: string | null) => (content ? retroBlocks(content) : []);

export async function loadNoteSource(db: PrismaClient, projectId: string, summary: string | null = null): Promise<NoteSource> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { benchmarkVideo: { include: { account: true } }, retro: true } });
  const script = ScriptSchema.safeParse(p.script);
  const a = p.benchmarkVideo ? AnalysisSchema.safeParse(p.benchmarkVideo.analysis) : null;
  const work = p.retro ? await db.publishedWork.findUnique({ where: { id: p.retro.workId } }) : null;
  const d = p.retro?.diagnosis as { stages?: { label: string; verdict: string; note: string }[] } | undefined;
  const lessons = p.retro ? await db.writingLesson.findMany({ where: { retroId: p.retro.id }, orderBy: { createdAt: 'asc' } }) : [];
  const lastWritten = await db.noteProposal.findFirst({ where: { projectId, status: 'written' }, orderBy: { updatedAt: 'desc' } });
  return {
    projectId,
    title: p.title,
    stage: p.stage,
    topic: a?.success ? a.data.topic : null,
    benchmark: p.benchmarkVideo ? { author: p.benchmarkVideo.account.nickname, digg: p.benchmarkVideo.digg, ratio: p.benchmarkVideo.ratio, url: p.benchmarkVideo.url } : null,
    segments: script.success ? script.data.segments.map((s) => ({ label: ROLE_LABEL[s.role], text: s.text })) : [],
    retro: p.retro ? { dayN: p.retro.dayN, viewCount: work?.viewCount ?? null, likeCount: work?.likeCount ?? null, stages: d?.stages ?? [], narrative: p.retro.narrative } : null,
    pastRetroBlocks: pastBlocksFrom(lastWritten?.content ?? null),
    lessons: lessons.map((l) => ({ text: l.text, status: l.status })),
    summary,
  };
}

export async function createProposal(db: PrismaClient, p: { projectId: string; trigger: ProposalTrigger; path: string; content: string }): Promise<string> {
  await db.noteProposal.updateMany({ where: { projectId: p.projectId, status: 'pending' }, data: { status: 'expired' } });
  const row = await db.noteProposal.create({ data: p });
  await db.chatMessage.create({ data: { projectId: p.projectId, role: 'system', content: PROPOSAL_PROMPT, toolName: 'note:proposal', toolResult: { ok: true, proposalId: row.id } } });
  return row.id;
}

export async function proposeProjectNote(db: PrismaClient, projectId: string, trigger: ProposalTrigger, summary: string | null = null): Promise<string> {
  const src = await loadNoteSource(db, projectId, summary);
  return createProposal(db, { projectId, trigger, path: noteFileName(src.title), content: buildRegion(src) });
}

/** 定稿 / 复盘后调用: 提议失败只记日志, 不影响主流程 */
export async function proposeSafely(db: PrismaClient, projectId: string, trigger: ProposalTrigger): Promise<void> {
  try {
    await proposeProjectNote(db, projectId, trigger);
  } catch (e) {
    console.warn(`[notes] 提议失败 ${projectId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function decideProposal(db: PrismaClient, id: string, action: 'accept' | 'reject', cfg: NotesConfig, today: string): Promise<ProposalView> {
  const p = await db.noteProposal.findUnique({ where: { id } });
  if (!p) throw new Error('找不到这个提议');
  if (p.status !== 'pending') throw new ProposalConflict('这个提议已经处理过了');
  if (action === 'reject') return toProposalView(await db.noteProposal.update({ where: { id }, data: { status: 'rejected', error: null } }));
  const project = await db.project.findUnique({ where: { id: p.projectId } });
  try {
    const rel = await writeProjectNote(cfg, p.path, { projectId: p.projectId, stage: project?.stage ?? 'draft', today }, p.content);
    return toProposalView(await db.noteProposal.update({ where: { id }, data: { status: 'written', path: rel, error: null } }));
  } catch (e) {
    return toProposalView(await db.noteProposal.update({ where: { id }, data: { error: e instanceof Error ? e.message : String(e) } }));
  }
}
