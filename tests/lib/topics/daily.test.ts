import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { addIdea, adoptDaily, dailyReason, deleteIdea, dismissDaily, listDaily, listIdeas, rewriteDaily } from '@/lib/topics/daily';
import type { GenDeps } from '@/lib/topics/generate';
import { createCandidateStore } from '@/lib/topics/deps';

type Row = Record<string, unknown> & { id: string };
const now = new Date('2026-10-09T15:00:00Z');

function fakeDb(seed: { topics?: Row[]; runs?: Row[]; ideas?: Row[] } = {}) {
  const topics: Row[] = seed.topics ?? [];
  const runs: Row[] = seed.runs ?? [];
  const ideas: Row[] = seed.ideas ?? [];
  const projects: Row[] = [];
  const chats: Row[] = [];
  const predictions: Row[] = [];
  const bench: Record<string, string> = {};
  const seenWhere: unknown[] = [];
  let seq = 0;
  const match = (r: Row, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => {
      if (v && typeof v === 'object' && 'lte' in (v as object)) return String(r[k]) <= String((v as { lte: string }).lte);
      if (v && typeof v === 'object' && 'not' in (v as object)) return r[k] !== (v as { not: unknown }).not;
      return r[k] === v;
    });
  const db: Record<string, unknown> = {
    dailyTopic: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = topics.filter((t) => match(t, where));
        hit.forEach((t) => Object.assign(t, data));
        return { count: hit.length };
      },
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => topics.filter((t) => !where || match(t, where)),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => topics.find((t) => t.id === where.id)!,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(topics.find((t) => t.id === where.id)!, data),
    },
    dailyTopicRun: { findFirst: async () => [...runs].sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0] ?? null },
    personaProfile: { findUnique: async () => null },
    project: { create: async ({ data }: { data: Row }) => { const p = { ...data, id: `p${++seq}` }; projects.push(p); return p; } },
    prediction: { create: async ({ data }: { data: Row }) => { predictions.push(data); return data; } },
    chatMessage: { create: async ({ data }: { data: Row }) => { chats.push(data); return data; } },
    benchmarkVideo: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'gone' ? null : { id: where.id }),
      update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => void (bench[where.id] = data.status),
      findMany: async (args: unknown) => (seenWhere.push(args), []),
    },
    topicIdea: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => ideas.filter((i) => match(i, where)),
      create: async ({ data }: { data: { text: string } }) => { const i = { id: `i${++seq}`, status: 'fresh', createdAt: now, ...data }; ideas.push(i); return i; },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(ideas.find((i) => i.id === where.id)!, data),
    },
  };
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return { db: db as unknown as PrismaClient, topics, projects, predictions, bench, ideas, seenWhere, chats };
}

const pred = (center: number) => ({ scores: [{ dim: 'hook', score: 4, reason: 'x' }], inputHash: `h${center}`, formulaVersion: 2, result: { center } });
const topic = (id: string, day: string, center: number | null, over: Row | object = {}): Row => ({
  id, day, source: 'idea', sourceId: `s-${id}`, title: `题${id}`, why: '理由', hook: '钩子', direction: '方向',
  script: { segments: [{ id: 'a', role: 'hook', text: '开头' }] }, copied: [], prediction: center === null ? null : pred(center), status: 'new', projectId: null, ...over,
});

describe('daily topics', () => {
  it('lists new topics by prediction, expiring ones older than 3 days', async () => {
    const { db, topics } = fakeDb({ topics: [topic('d1', '2026-10-09', 3000), topic('d2', '2026-10-09', 8000), topic('d3', '2026-10-09', null), topic('d4', '2026-10-06', 9000)] });
    const r = await listDaily(db, now);
    expect(r.topics.map((t) => t.id)).toEqual(['d2', 'd1', 'd3']);
    expect(topics.find((t) => t.id === 'd4')!.status).toBe('expired');
    expect(r.topics[0]).toMatchObject({ sourceLabel: '点子', predictedCenter: 8000, copied: 0 });
  });
  it('adoptDaily creates a project whose script is the draft and stores the same prediction', async () => {
    const { db, topics, projects, predictions, bench } = fakeDb({ topics: [topic('d1', '2026-10-09', 4500, { source: 'benchmark', sourceId: 'bv1' })] });
    const r = await adoptDaily(db, 'd1');
    expect(projects[0]).toMatchObject({ title: '题d1', targetSec: 75, benchmarkVideoId: 'bv1', script: { segments: [{ id: 'a', role: 'hook', text: '开头' }] } });
    expect(predictions[0]).toMatchObject({ projectId: r.projectId, kind: 'draft', inputHash: 'h4500', formulaVersion: 2 });
    expect(topics[0]).toMatchObject({ status: 'adopted', projectId: r.projectId });
    expect(bench.bv1).toBe('adopted');
  });
  it('adopting twice creates one project', async () => {
    const { db, projects } = fakeDb({ topics: [topic('d1', '2026-10-09', null)] });
    await adoptDaily(db, 'd1');
    await expect(adoptDaily(db, 'd1')).rejects.toThrow('这个选题已经处理过了');
    expect(projects).toHaveLength(1);
  });
  it('dismissDaily hides it and it never comes back as a candidate', async () => {
    const { db } = fakeDb({ topics: [topic('d1', '2026-10-09', 1000)] });
    await dismissDaily(db, 'd1');
    expect((await listDaily(db, now)).topics).toEqual([]);
    expect((await createCandidateStore(db).usedKeys()).has('idea:s-d1')).toBe(true);
    await expect(dismissDaily(db, 'd1')).rejects.toThrow('这个选题已经处理过了');
  });
  it('ideas can be added, listed and soft-deleted', async () => {
    const { db, ideas } = fakeDb();
    await expect(addIdea(db, '   ')).rejects.toThrow('点子是空的');
    const i = await addIdea(db, ' 讲讲 vibe coding 踩过的坑 ');
    expect(i).toMatchObject({ text: '讲讲 vibe coding 踩过的坑', status: 'fresh' });
    await deleteIdea(db, i.id);
    expect(ideas[0].status).toBe('deleted');
    expect(await listIdeas(db)).toEqual([]);
  });
  it('lastRun reports the reasons of the latest run', async () => {
    const { db } = fakeDb({ runs: [
      { id: 'r1', day: '2026-10-08', created: 3, skipped: [], createdAt: new Date('2026-10-08T15:00:00Z') },
      { id: 'r2', day: '2026-10-09', created: 0, skipped: [{ reason: '还没有可用的模型' }], createdAt: new Date('2026-10-09T15:00:00Z') },
    ] });
    expect((await listDaily(db, now)).lastRun).toEqual({ day: '2026-10-09', created: 0, reasons: ['还没有可用的模型'] });
  });
  it('adopts a benchmark topic whose benchmark video was deleted, without linking it', async () => {
    const { db, projects } = fakeDb({ topics: [topic('d1', '2026-10-09', null, { source: 'benchmark', sourceId: 'gone' })] });
    await adoptDaily(db, 'd1');
    expect(projects[0].benchmarkVideoId).toBeUndefined();
  });
  it('does not offer benchmark hits that were already made into projects', async () => {
    const { db, seenWhere } = fakeDb();
    await createCandidateStore(db).benchmarkHits(now);
    expect(seenWhere[0]).toMatchObject({ where: { status: { notIn: ['ignored', 'adopted'] }, OR: [{ isHit: true }, { ratio: { gte: 3 } }] } });
  });
  it('only explains an empty day when the last run produced nothing', () => {
    expect(dailyReason({ day: '2026-10-09', created: 0, reasons: ['还没有可用的模型'] })).toBe('还没有可用的模型');
    expect(dailyReason({ day: '2026-10-09', created: 2, reasons: ['写稿失败：x'] })).toBeNull();
    expect(dailyReason(null)).toBeNull();
  });
  const list = [{ test: '低中高三档各问一次', record: '各自用时' }, { test: '对比答案', record: '有没有要点' }];
  it('lists the checklist and filled results on the card', async () => {
    const { db } = fakeDb({ topics: [topic('d1', '2026-10-09', 1000, { checklist: list, results: ['3 秒', ''] })] });
    expect((await listDaily(db, now)).topics[0]).toMatchObject({ checklist: list, results: ['3 秒', ''] });
  });
  it('rewrites a topic from filled results and stores script, results and prediction', async () => {
    const { db, topics } = fakeDb({ topics: [topic('d1', '2026-10-09', 1000, { checklist: list })] });
    const deps = {
      llm: {} as never,
      noModelReason: '没有模型',
      personaText: '',
      lessons: undefined, samples: [],
      write: (async () => ({ title: 't', script: { segments: [{ id: 'a', role: 'hook', text: '按实测重写' }] }, report: { ok: true }, rounds: 0 })) as unknown as GenDeps['write'],
      predict: async () => pred(6000) as never,
    };
    await rewriteDaily(db, deps, 'd1', ['3 秒', '有']);
    expect(topics[0]).toMatchObject({ results: ['3 秒', '有'], script: { segments: [{ text: '按实测重写' }] }, prediction: { inputHash: 'h6000' } });
  });
  it('carries an unfinished checklist into the new project chat on adopt', async () => {
    const { db, chats } = fakeDb({ topics: [topic('d1', '2026-10-09', null, { checklist: list, results: ['3 秒', ''] })] });
    const r = await adoptDaily(db, 'd1');
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ projectId: r.projectId, role: 'system', toolName: 'job:topic' });
    expect(String(chats[0].content)).toContain('1. 低中高三档各问一次 → 记下：各自用时（已测：3 秒）');
    expect(String(chats[0].content)).toContain('2. 对比答案 → 记下：有没有要点');
  });
  it('adds no chat message for a talk topic', async () => {
    const { db, chats } = fakeDb({ topics: [topic('d1', '2026-10-09', null)] });
    await adoptDaily(db, 'd1');
    expect(chats).toEqual([]);
  });
});

