import { describe, expect, it } from 'vitest';
import { patchScriptTool } from '@/lib/tools/patch-script';
import { createFakeDb } from '../../helpers/fake-db';
import { SEGMENT_ROLES } from '@/lib/script/model';
import type { StructuredLLM } from '@/lib/script/write';

const llm = {} as StructuredLLM;
const lengths = [30, 67, 67, 187, 67, 22];
const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字'.repeat(lengths[i]) })) };

describe('patch_script tool', () => {
  it('replaces one segment and reports before/after seconds', async () => {
    const { db, project } = createFakeDb({ project: { script } });
    const r = await patchScriptTool.execute({ projectId: 'p1', db, llm }, { segmentId: 's4', text: '字'.repeat(45) });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe('改稿：第4段「冷知识」37.4s → 9s');
    expect(r.segmentIds).toEqual(['s4']);
    expect((project.script as typeof script).segments[3].text).toHaveLength(45);
    expect(r.data).toMatchObject({ durationOk: true, issues: [] });
  });

  it('applies but returns issues when still over limit', async () => {
    const { db } = createFakeDb({ project: { script } });
    const r = await patchScriptTool.execute({ projectId: 'p1', db, llm }, { segmentId: 's4', text: '字'.repeat(100) });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ durationOk: false });
    expect((r.data as { issues: string[] }).issues[0]).toContain('第4段「冷知识」约 20 秒，上限 11.3 秒');
  });

  it('fails readably when there is no script yet', async () => {
    const { db } = createFakeDb();
    const r = await patchScriptTool.execute({ projectId: 'p1', db, llm }, { segmentId: 's1', text: 'x' });
    expect(r).toMatchObject({ ok: false, summary: '改稿失败：还没有稿子，先写一版' });
  });

  it('fails readably on unknown segment id', async () => {
    const { db } = createFakeDb({ project: { script } });
    const r = await patchScriptTool.execute({ projectId: 'p1', db, llm }, { segmentId: 's9', text: 'x' });
    expect(r.ok).toBe(false);
    expect(r.summary).toBe('改稿失败：没有编号为 s9 的段落，可用编号：s1、s2、s3、s4、s5、s6');
  });
});
