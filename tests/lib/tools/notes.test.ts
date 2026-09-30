import { describe, expect, it } from 'vitest';
import { makeNotesTools } from '@/lib/tools/notes';
import { makeVault } from '../notes/fixture';

const ctx = { projectId: 'p1', db: {} as never, llm: {} as never };

describe('notes tools', () => {
  it('searches and reads notes with text for the model', async () => {
    const v = await makeVault({ '5-灵感/AI 剪辑翻车.md': '用 AI 剪辑翻车了三次' });
    const [search, read] = makeNotesTools(async () => ({ vault: v, readFolders: ['5-灵感'] }));
    const s = await search.execute(ctx, { query: '翻车' });
    expect(s).toMatchObject({ ok: true, summary: '搜笔记「翻车」：找到 1 篇' });
    expect((s.data as { text: string }).text).toContain('5-灵感/AI 剪辑翻车.md');
    const r = await read.execute(ctx, { path: '5-灵感/AI 剪辑翻车.md' });
    expect(r).toMatchObject({ ok: true, summary: '读笔记：AI 剪辑翻车' });
    expect((r.data as { text: string }).text).toContain('翻车了三次');
  });
  it('fails readably when the vault is missing or the path is outside', async () => {
    const v = await makeVault({ '2-领域/人生/日记.md': '私人' });
    const [search, read] = makeNotesTools(async () => ({ vault: null, readFolders: [] }));
    expect(await search.execute(ctx, { query: 'x' })).toMatchObject({ ok: false, summary: '搜笔记失败：没找到 Obsidian 库：去设置页填库路径' });
    const [, read2] = makeNotesTools(async () => ({ vault: v, readFolders: ['5-灵感'] }));
    expect(await read2.execute(ctx, { path: '2-领域/人生/日记.md' })).toMatchObject({ ok: false, summary: '读笔记失败：这篇笔记不在允许读取的文件夹里' });
    expect(read.name).toBe('read_note');
  });
});
