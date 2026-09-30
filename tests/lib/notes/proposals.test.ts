import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { createProposal, decideProposal, notePathFor, PROPOSAL_PROMPT, ProposalConflict } from '@/lib/notes/proposals';
import { START } from '@/lib/notes/note';
import { makeVault } from './fixture';
import { pastBlocksFrom } from '@/lib/notes/proposals';
import { buildRegion } from '@/lib/notes/note';

type Row = { id: string; projectId: string; trigger: string; path: string; content: string; status: string; error: string | null; createdAt: Date; updatedAt: Date };

function proposalDb(stage = 'scripted') {
  const rows: Row[] = [];
  const chat: { projectId: string; role: string; content: string; toolName: string; toolResult: unknown }[] = [];
  let seq = 0;
  const db = {
    noteProposal: {
      updateMany: async ({ where, data }: { where: { projectId?: string; id?: string; status: string }; data: Partial<Row> }) => {
        const hit = rows.filter((r) => (!where.projectId || r.projectId === where.projectId) && (!where.id || r.id === where.id) && r.status === where.status);
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
      create: async ({ data }: { data: Omit<Row, 'id' | 'status' | 'error' | 'createdAt' | 'updatedAt'> }) => {
        const r: Row = { id: `np${++seq}`, status: 'pending', error: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.push(r);
        return { ...r };
      },
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const r = rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return { ...r };
      },
    },
    project: { findUnique: async () => ({ id: 'cmabc123456', stage }) },
    chatMessage: { create: async ({ data }: { data: (typeof chat)[number] }) => void chat.push(data) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaClient;
  return { db, rows, chat };
}

const base = { projectId: 'cmabc123456', trigger: 'finalize' as const, path: 'MediaPilot/项目/测试.md', content: '# 测试' };

describe('note proposals', () => {
  it('expires older pending proposals and posts a card line in the project chat', async () => {
    const { db, rows, chat } = proposalDb();
    const a = await createProposal(db, base);
    const b = await createProposal(db, { ...base, trigger: 'retro' });
    expect(rows.find((r) => r.id === a)!.status).toBe('expired');
    expect(rows.find((r) => r.id === b)!.status).toBe('pending');
    expect(chat.at(-1)).toMatchObject({ projectId: 'cmabc123456', role: 'system', content: PROPOSAL_PROMPT, toolName: 'note:proposal', toolResult: { ok: true, proposalId: b } });
  });
  it('writes the note on accept', async () => {
    const v = await makeVault({});
    const { db } = proposalDb();
    const id = await createProposal(db, base);
    const view = await decideProposal(db, id, 'accept', { vault: v, readFolders: [] }, '2026-09-30');
    expect(view).toMatchObject({ status: 'written', path: 'MediaPilot/项目/测试.md', error: null });
    expect(await fs.readFile(path.join(v, 'MediaPilot/项目/测试.md'), 'utf8')).toContain(`${START}\n# 测试`);
  });
  it('rejects without writing', async () => {
    const { db } = proposalDb();
    const id = await createProposal(db, base);
    expect((await decideProposal(db, id, 'reject', { vault: null, readFolders: [] }, '2026-09-30')).status).toBe('rejected');
  });
  it('refuses a proposal that was already handled', async () => {
    const { db } = proposalDb();
    const id = await createProposal(db, base);
    await createProposal(db, base);
    await expect(decideProposal(db, id, 'accept', { vault: null, readFolders: [] }, '2026-09-30')).rejects.toThrow(ProposalConflict);
  });
  it('keeps the proposal pending with the reason when writing fails', async () => {
    const { db } = proposalDb();
    const id = await createProposal(db, base);
    const view = await decideProposal(db, id, 'accept', { vault: '/nonexistent/vault', readFolders: [] }, '2026-09-30');
    expect(view).toMatchObject({ status: 'pending', error: '没找到 Obsidian 库：去设置页填库路径' });
  });
});

describe('retro history', () => {
  it('keeps earlier retro days from the last written note', () => {
    const src = { projectId: 'p', title: 't', stage: 'published', topic: null, benchmark: null, segments: [], pastRetroBlocks: [], lessons: [], summary: null };
    const day3 = buildRegion({ ...src, retro: { dayN: 3, viewCount: 1, likeCount: 1, stages: [], narrative: null } });
    const day7 = buildRegion({ ...src, retro: { dayN: 7, viewCount: 9, likeCount: 9, stages: [], narrative: null }, pastRetroBlocks: pastBlocksFrom(day3) });
    expect(day7).toContain('### 第 3 天 · 播放 1');
    expect(day7).toContain('### 第 7 天 · 播放 9');
    expect(pastBlocksFrom(null)).toEqual([]);
  });
});

describe('proposal safety', () => {
  it('lets only one of two simultaneous confirmations write', async () => {
    const v = await makeVault({});
    const { db } = proposalDb();
    const id = await createProposal(db, base);
    const cfg = { vault: v, readFolders: [] };
    const rs = await Promise.allSettled([decideProposal(db, id, 'accept', cfg, '2026-09-30'), decideProposal(db, id, 'accept', cfg, '2026-09-30')]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rs.filter((r) => r.status === 'rejected' && r.reason instanceof ProposalConflict)).toHaveLength(1);
  });
  it('keeps writing to the note of a renamed project', () => {
    expect(notePathFor('新名字', 'MediaPilot/项目/旧名字.md')).toBe('MediaPilot/项目/旧名字.md');
    expect(notePathFor('新名字', null)).toBe('MediaPilot/项目/新名字.md');
  });
  it('recovers a write that was interrupted long ago', async () => {
    const v = await makeVault({});
    const { db, rows } = proposalDb();
    const id = await createProposal(db, base);
    Object.assign(rows.find((r) => r.id === id)!, { status: 'writing', updatedAt: new Date(Date.now() - 10 * 60_000) });
    expect((await decideProposal(db, id, 'accept', { vault: v, readFolders: [] }, '2026-09-30')).status).toBe('written');
  });
});
