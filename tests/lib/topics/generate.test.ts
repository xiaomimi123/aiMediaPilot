import { describe, expect, it } from 'vitest';
import { generateDailyTopics, runOutcome, succeededRecently, type GenDeps, type NewDailyTopic } from '@/lib/topics/generate';
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
});
