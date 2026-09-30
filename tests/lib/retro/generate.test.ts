import { describe, expect, it, vi } from 'vitest';
import { dueRetros, generateRetro, type RetroDeps, type RetroInput } from '@/lib/retro/generate';
import type { StructuredLLM } from '@/lib/script/write';

const now = new Date('2026-10-02T12:00:00Z');
const ms = { viewCount: 1000, likeCount: 20, favoriteCount: 5, shareCount: 2, subscribeCount: 1, completionRate: 0.1, completionRate5s: 0.5, bounceRate2s: 0.3, avgViewSec: 10 };
const input = (over: Partial<RetroInput> = {}): RetroInput => ({
  projectId: 'p1', workId: 'w1', publishedAt: new Date('2026-09-29T12:00:00Z'), work: ms, metricsUpdatedAt: new Date('2026-10-02T00:00:00Z'),
  history: [ms, ms, ms], lines: null, benchmark: null, curve: [], scriptText: '稿', transcriptText: '转写', benchmarkAnalysis: '', activeLessons: [{ id: 'L1', text: '开头先给结果' }], ...over,
});

function deps(over: Partial<RetroDeps> = {}, llmResult?: unknown) {
  const saved: Parameters<RetroDeps['save']>[0][] = [];
  const llm = { callStructured: vi.fn(async () => ({ result: llmResult ?? { summary: '开头掉人多。', lessons: [{ text: '第一句直接说结果', stage: 'hook', evidenceMetric: 'bounceRate2s' }], contradicts: [] }, usage: {} })) } as unknown as StructuredLLM;
  const d: RetroDeps = { load: async () => input(), llm, save: async (r) => void saved.push(r), now: () => now, ...over };
  return { d, saved };
}

describe('generateRetro', () => {
  it('saves diagnosis, narrative and candidate lessons with evidence', async () => {
    const { d, saved } = deps();
    expect(await generateRetro(d, 'p1')).toEqual({ ok: true });
    expect(saved[0]).toMatchObject({ dayN: 3, narrative: '开头掉人多。', narrativeError: null });
    expect(saved[0].lessons[0]).toMatchObject({ text: '第一句直接说结果', stage: 'hook' });
    expect(saved[0].lessons[0].evidence[0]).toMatchObject({ projectId: 'p1', workId: 'w1', metric: 'bounceRate2s', value: 0.3 });
  });
  it('waits when metrics are not out yet', async () => {
    const { d, saved } = deps({ load: async () => input({ work: { ...ms, viewCount: 0 }, metricsUpdatedAt: null }) });
    expect(await generateRetro(d, 'p1')).toEqual({ ok: false, reason: '数据还没出来，明晚回采后再复盘。' });
    expect(saved).toHaveLength(0);
  });
  it('waits when views are in but the retention rates are not yet', async () => {
    const { d, saved } = deps({ load: async () => input({ work: { ...ms, completionRate5s: null, bounceRate2s: null, avgViewSec: null } }) });
    expect(await generateRetro(d, 'p1')).toEqual({ ok: false, reason: '数据还没出来，明晚回采后再复盘。' });
    expect(saved).toHaveLength(0);
  });
  it('still saves the diagnosis when the model fails', async () => {
    const { d, saved } = deps({ llm: { callStructured: vi.fn(async () => { throw new Error('x'); }) } as unknown as StructuredLLM });
    await generateRetro(d, 'p1');
    expect(saved[0]).toMatchObject({ narrative: null, narrativeError: '编导解读没写出来，点重试。' });
    expect(saved[0].diagnosis.stages.length).toBeGreaterThan(0);
  });
  it('proposes a note after saving, and a failed proposal does not fail the retro', async () => {
    const proposeNote = vi.fn(async () => { throw new Error('vault gone'); });
    const { d, saved } = deps({ proposeNote });
    expect(await generateRetro(d, 'p1')).toEqual({ ok: true });
    expect(saved).toHaveLength(1);
    expect(proposeNote).toHaveBeenCalledWith('p1');
  });
  it('keeps at most 3 valid lessons and passes contradicted ids', async () => {
    const lessons = [1, 2, 3, 4].map((i) => ({ text: `经验${i}`, stage: i === 2 ? 'bogus' : 'hook', evidenceMetric: 'bounceRate2s' }));
    const { d, saved } = deps({}, { summary: 's', lessons, contradicts: ['L1', 'not-a-lesson'] });
    await generateRetro(d, 'p1');
    expect(saved[0].lessons.map((l) => l.text)).toEqual(['经验1', '经验3', '经验4']);
    expect(saved[0].contradictedIds).toEqual(['L1']);
  });
});

describe('dueRetros', () => {
  it('generates at day 3 and updates once at day 7', () => {
    const d = (days: number) => new Date(now.getTime() - days * 86400_000);
    expect(dueRetros([
      { projectId: 'a', publishedAt: d(2), retroDayN: null },
      { projectId: 'b', publishedAt: d(3.1), retroDayN: null },
      { projectId: 'c', publishedAt: d(7.2), retroDayN: 3 },
      { projectId: 'e', publishedAt: d(8), retroDayN: 7 },
      { projectId: 'f', publishedAt: d(3.5), retroDayN: 1 },
    ], now)).toEqual(['b', 'c', 'f']);
  });
});
