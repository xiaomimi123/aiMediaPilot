import { describe, expect, it } from 'vitest';
import { writeScriptTool } from '@/lib/tools/write-script';
import { createFakeDb } from '../../helpers/fake-db';
import type { StructuredLLM } from '@/lib/script/write';

const onBudget = [30, 67, 67, 45, 67, 22];
const llm: StructuredLLM = {
  callStructured: (async () => ({
    result: { title: '让AI当反方', segments: onBudget.map((n) => ({ role: 'x', text: '字'.repeat(n) })) },
    usage: { model: 'fake', promptTokens: 0, completionTokens: 0, estCostUSD: 0 },
  })) as unknown as StructuredLLM['callStructured'],
};

describe('write_script tool', () => {
  it('saves the script, sets the title of an untitled project, reports duration', async () => {
    const { db, project } = createFakeDb();
    const r = await writeScriptTool.execute({ projectId: 'p1', db, llm }, { direction: '让AI挑刺' });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe('写稿：6 段，约 59.6 秒');
    expect(r.segmentIds).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(project.title).toBe('让AI当反方');
    expect((project.script as { segments: unknown[] }).segments).toHaveLength(6);
  });

  it('keeps a title the user already set', async () => {
    const { db, project } = createFakeDb({ project: { title: '我自己的标题' } });
    await writeScriptTool.execute({ projectId: 'p1', db, llm }, { direction: '让AI挑刺' });
    expect(project.title).toBe('我自己的标题');
  });
  it('passes the benchmark reference to the writer and reports copied sentences', async () => {
    const firstMessages: string[] = [];
    const copyLlm: StructuredLLM = {
      callStructured: (async (o: { userMessage: { text: string }[] }) => {
        firstMessages.push(o.userMessage[0].text);
        return { result: { title: 't', segments: onBudget.map((n, i) => ({ role: 'x', text: i === 0 ? '很多人对AI的印象还停留在聊天写代码' : '字'.repeat(n) })) }, usage: {} };
      }) as unknown as StructuredLLM['callStructured'],
    };
    const { db } = createFakeDb({
      project: { benchmarkVideoId: 'bv1' },
      benchmarkVideo: { id: 'bv1', transcript: '很多人对AI的印象还停留在聊天写代码的线上工具', analysis: null, ratio: 3, account: { nickname: '园长说AI' } },
    });
    const r = await writeScriptTool.execute({ projectId: 'p1', db, llm: copyLlm }, { direction: '讲 AI 帮人' });
    expect(firstMessages[0]).toContain('【参考的对标作品】');
    expect((r.data as { copied: unknown[] }).copied).toEqual([{ segmentId: 's1', segment: '钩子', text: '很多人对AI的印象还停留在聊天写代码' }]);
    expect(r.summary).toContain('「钩子」有 1 处照抄对标原句');
  });
  it('passes active writing lessons to the writer', async () => {
    const msgs: string[] = [];
    const spy: StructuredLLM = {
      callStructured: (async (o: { userMessage: { text: string }[] }) => {
        msgs.push(o.userMessage[0].text);
        return { result: { title: 't', segments: onBudget.map((n) => ({ role: 'x', text: '字'.repeat(n) })) }, usage: {} };
      }) as unknown as StructuredLLM['callStructured'],
    };
    const { db } = createFakeDb({ lessons: [{ text: '第一句直接说结果', evidence: [{}, {}] }] });
    await writeScriptTool.execute({ projectId: 'p1', db, llm: spy }, { direction: 'x' });
    expect(msgs[0]).toContain('【写法经验】');
    expect(msgs[0]).toContain('第一句直接说结果（2 条作品）');
  });
});
