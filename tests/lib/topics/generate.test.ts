import { describe, expect, it } from 'vitest';
import { generateDailyTopics, normalizePlan, rewriteWithAnswers, runOutcome, succeededRecently, type GenDeps, type NewDailyTopic } from '@/lib/topics/generate';
import type { StructuredLLM } from '@/lib/script/write';
import type { Script } from '@/lib/script/model';

const now = new Date('2026-10-09T15:00:00Z');
const script = (t: string) => ({ segments: [{ id: 's1', role: 'hook', text: t }] }) as unknown as Script;
const plan = (title: string) => ({ title, why: '对上定位', hook: '开头一句', direction: `讲 ${title} 的方向说明，至少十个字` });

function deps(over: Partial<GenDeps> = {}) {
  const saved: NewDailyTopic[] = [];
  const runs: { created: number; skipped: unknown[] }[] = [];
  const used: string[] = [];
  const d: GenDeps = {
    llm: { callStructured: async ({ userMessage }: { userMessage: { text: string }[] }) => ({ result: plan(userMessage[0].text.includes('点子') ? '点子题' : userMessage[0].text.includes('续集') ? '续集题' : '对标题'), usage: {} }) } as unknown as StructuredLLM,
    noModelReason: '还没有可用的模型',
    now,
    store: {
      usedKeys: async () => new Set(),
      benchmarkHits: async () => [{ id: 'b1', ratio: 5, author: 'A', topic: 'AI 回消息', desc: '', transcript: '对标原文一二三四五六七八九十一二' }],
      ownWorks: async () => [{ projectId: 'p1', title: 'U盘', lastText: '单独来讲一期', play: 300 }],
      freshIdeas: async () => [{ id: 'i1', text: '讲讲 vibe coding 踩过的坑', createdAt: new Date('2026-10-01') }],
    },
    personaText: '定位',
    lessons: undefined,
    samples: [],
    write: (async ({ direction }: { direction: string }) => ({ title: 't', script: script(direction), report: { ok: true }, rounds: 0 })) as unknown as GenDeps['write'],
    predict: async () => ({ scores: [], inputHash: 'h', formulaVersion: 1, result: { center: 4500 } as never }),
    save: async (t) => (saved.push(t), 'saved'),
    markIdeaUsed: async (id) => void used.push(id),
    recordRun: async (r) => void runs.push(r),
    doneRecently: async () => false,
    ...over,
  };
  return { d, saved, runs, used };
}

describe('generateDailyTopics', () => {
  it('writes three topics, one per source, with drafts and predictions', async () => {
    const { d, saved, runs, used } = deps();
    const r = await generateDailyTopics(d);
    expect(r).toMatchObject({ created: 3, skipped: [] });
    expect(saved.map((s) => [s.source, s.title])).toEqual([['benchmark', '对标题'], ['sequel', '续集题'], ['idea', '点子题']]);
    expect(saved[0]).toMatchObject({ day: '2026-10-09', prediction: { inputHash: 'h' } });
    expect(used).toEqual(['i1']);
    expect(runs).toEqual([{ day: '2026-10-09', created: 3, skipped: [] }]);
  });
  it('keeps a topic when its prediction fails', async () => {
    const { d, saved } = deps({ predict: async () => null });
    await generateDailyTopics(d);
    expect(saved).toHaveLength(3);
    expect(saved[0].prediction).toBeNull();
  });
  it('skips a candidate whose draft fails and keeps the rest', async () => {
    const { d, saved, runs } = deps({
      write: (async ({ direction }: { direction: string }) => {
        if (direction.includes('续集')) throw new Error('模型这次没按 6 段格式交稿');
        return { title: 't', script: script(direction), report: { ok: true }, rounds: 0 };
      }) as unknown as GenDeps['write'],
    });
    const r = await generateDailyTopics(d);
    expect(saved.map((s) => s.source)).toEqual(['benchmark', 'idea']);
    expect(r.skipped).toEqual([{ source: 'sequel', reason: '写稿失败：模型这次没按 6 段格式交稿' }]);
    expect(runs[0].created).toBe(2);
  });
  it('skips a candidate when the topic plan is malformed', async () => {
    const { d, saved } = deps({ llm: { callStructured: async () => ({ result: { title: '', why: '', hook: '', direction: '' }, usage: {} }) } as unknown as StructuredLLM });
    const r = await generateDailyTopics(d);
    expect(saved).toEqual([]);
    expect(r.skipped.every((s) => s.reason.startsWith('定选题失败'))).toBe(true);
  });
  it('skips a candidate that another run already saved', async () => {
    const { d } = deps({ save: async (t) => (t.source === 'benchmark' ? 'duplicate' : 'saved') });
    const r = await generateDailyTopics(d);
    expect(r.created).toBe(2);
    expect(r.skipped).toEqual([{ source: 'benchmark', reason: '这个选题刚被另一次运行生成过' }]);
  });
  it('flags copied lines from a benchmark reference', async () => {
    const { d, saved } = deps({ write: (async () => ({ title: 't', script: script('对标原文一二三四五六七八九十一二'), report: { ok: true }, rounds: 0 })) as unknown as GenDeps['write'] });
    await generateDailyTopics(d);
    expect((saved[0].copied as unknown[]).length).toBeGreaterThan(0);
  });
  it('records why nothing was generated', async () => {
    const none = deps({ store: { usedKeys: async () => new Set(), benchmarkHits: async () => [], ownWorks: async () => [], freshIdeas: async () => [] } });
    expect(await generateDailyTopics(none.d)).toMatchObject({ created: 0, skipped: [{ reason: '没有可用的选题来源：加几个对标账号，或在点子池里写几句' }] });
    const noModel = deps({ llm: null });
    expect(await generateDailyTopics(noModel.d)).toMatchObject({ created: 0, skipped: [{ reason: '还没有可用的模型' }] });
    expect(noModel.runs).toHaveLength(1);
  });
  it('a scheduled run skips when today already succeeded; a manual run does not', async () => {
    const { d, saved } = deps({ doneRecently: async () => true });
    expect(await generateDailyTopics(d, { scheduled: true })).toMatchObject({ alreadyDone: true, created: 0 });
    expect(saved).toEqual([]);
    expect((await generateDailyTopics(d)).created).toBe(3);
  });
  it('a retry after midnight skips when the 23:00 run succeeded, but the next night runs', () => {
    const at2300 = new Date('2026-10-09T15:00:00Z');
    expect(succeededRecently([at2300], new Date('2026-10-09T16:00:00Z'))).toBe(true);
    expect(succeededRecently([at2300], new Date('2026-10-09T17:00:00Z'))).toBe(true);
    expect(succeededRecently([at2300], new Date('2026-10-10T15:00:00Z'))).toBe(false);
    expect(succeededRecently([], new Date('2026-10-10T15:00:00Z'))).toBe(false);
  });
  it('a run whose candidates were all taken by another run is not a failure', () => {
    expect(runOutcome({ created: 0, skipped: [{ source: 'idea', reason: '这个选题刚被另一次运行生成过' }] })).toBe('done');
    expect(runOutcome({ created: 0, skipped: [{ reason: '没有可用的选题来源：加几个对标账号，或在点子池里写几句' }] })).toBe('done');
    expect(runOutcome({ created: 0, skipped: [{ reason: '还没有可用的模型' }] })).toBe('failed');
    expect(runOutcome({ created: 0, skipped: [{ source: 'idea', reason: '写稿失败：x' }] })).toBe('failed');
    expect(runOutcome({ created: 1, skipped: [] })).toBe('done');
  });
  it('passes the speaking samples to the writer', async () => {
    const got: (string[] | undefined)[] = [];
    const { d } = deps({ samples: ['样本原文'], write: (async (o: { direction: string; samples?: string[] }) => (got.push(o.samples), { title: 't', script: script(o.direction), report: { ok: true }, rounds: 0 })) as unknown as GenDeps['write'] });
    await generateDailyTopics(d);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((s) => s?.[0] === '样本原文')).toBe(true);
  });
  it('passes the candidate material as facts and tells the planner not to invent results', async () => {
    const systems: string[] = [];
    const facts: (string | undefined)[] = [];
    const { d } = deps({
      llm: { callStructured: async ({ systemPrompt }: { systemPrompt: string }) => (systems.push(systemPrompt), { result: plan('点子题'), usage: {} }) } as unknown as StructuredLLM,
      write: (async (o: { direction: string; facts?: string }) => (facts.push(o.facts), { title: 't', script: script(o.direction), report: { ok: true }, rounds: 0 })) as unknown as GenDeps['write'],
    });
    await generateDailyTopics(d);
    expect(systems[0]).toContain('direction 里不要写任何测试结果、亲身经历或数字');
    expect(facts).toContain('讲讲 vibe coding 踩过的坑');
  });
  it('plans questions to collect real material and folds a test checklist into them', () => {
    const base = { title: 't', why: 'w', hook: 'h', direction: '要实测三档的速度和质量差别' };
    const list = [{ test: '低中高三档各问一次同一个问题', record: '各自用时' }];
    const qs = ['你平时用哪一档？', '哪一次让你觉得档位有用？', '当时什么感受？', '你平时用哪一档？'];
    expect(normalizePlan({ ...base, questions: qs }).questions).toEqual(['你平时用哪一档？', '哪一次让你觉得档位有用？', '当时什么感受？']);
    expect(normalizePlan({ ...base, kind: 'test', checklist: list, questions: ['你平时用哪一档？'] }).questions).toEqual(['你平时用哪一档？', '实测：低中高三档各问一次同一个问题，记下：各自用时']);
    expect(normalizePlan({ ...base, kind: 'talk', checklist: list, questions: 'x' }).questions).toEqual([]);
    expect(normalizePlan({ ...base, questions: Array.from({ length: 9 }, (_, i) => `问题${i}`) }).questions).toHaveLength(6);
    expect(() => normalizePlan({ ...base, title: '' })).toThrow();
  });
  it('saves the questions with the topic and asks the planner for story material', async () => {
    const systems: string[] = [];
    const { d, saved } = deps({
      llm: { callStructured: async ({ systemPrompt }: { systemPrompt: string }) => (systems.push(systemPrompt), { result: { ...plan('实测题'), questions: ['收藏了多少个？', '留下哪几个？', '哪一次最惊喜？', '当时什么感受？'] }, usage: {} }) } as unknown as StructuredLLM,
    });
    await generateDailyTopics(d);
    expect(saved[0].questions).toHaveLength(4);
    expect(systems[0]).toContain('questions');
    expect(systems[0]).toContain('能讲成故事的真事');
    expect(systems[0]).toContain('问题里不要假设博主做过什么');
  });
  it('writes from answers and keeps unanswered gaps as 待补', async () => {
    const calls: { direction: string; facts?: string; answers?: { q: string; a: string }[]; samples?: string[] }[] = [];
    const { d } = deps({ samples: ['样本'], write: (async (o: (typeof calls)[number]) => (calls.push(o), { title: 't', script: script('新稿'), report: { ok: true }, rounds: 0 })) as unknown as GenDeps['write'] });
    const r = await rewriteWithAnswers(d, { title: '收藏夹', hook: '开头', direction: '方向', source: 'idea', sourceId: 'i1', questions: ['收藏了多少个？', '留下哪几个？'] }, ['一百多个', ' ']);
    expect(calls[0].answers).toEqual([{ q: '收藏了多少个？', a: '一百多个' }]);
    expect(calls[0].facts ?? '').not.toContain('留下哪几个');
    expect(calls[0].samples).toEqual(['样本']);
    expect(r.script.segments[0].text).toBe('新稿');
    expect(r.prediction).toMatchObject({ inputHash: 'h' });
  });
  it('keeps the user idea as facts when rewriting from answers', async () => {
    const calls: { facts?: string }[] = [];
    const { d } = deps({ write: (async (o: { facts?: string }) => (calls.push(o), { title: 't', script: script('新稿'), report: { ok: true }, rounds: 0 })) as unknown as GenDeps['write'] });
    await rewriteWithAnswers(d, { title: 't', hook: 'h', direction: 'd', source: 'idea', sourceId: 'i1', questions: ['a'], material: '讲讲 vibe coding 踩过的坑' }, ['答']);
    expect(calls[0].facts).toBe('讲讲 vibe coding 踩过的坑');
  });
  it('refuses to write with no answers', async () => {
    const { d } = deps();
    await expect(rewriteWithAnswers(d, { title: 't', hook: 'h', direction: 'd', source: 'idea', sourceId: 'i1', questions: ['a'] }, ['  '])).rejects.toThrow('先答至少一个问题');
  });
});

