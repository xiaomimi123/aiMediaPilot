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
});
