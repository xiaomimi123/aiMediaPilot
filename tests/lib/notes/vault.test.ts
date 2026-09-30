import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { searchNotes, readNote, listReadableNotes, NotesError } from '@/lib/notes/vault';
import { makeVault } from './fixture';

const FILES = {
  '5-灵感/AI 剪辑翻车.md': '---\ntags: [剪辑]\n---\n用 AI 剪辑翻车了三次，字幕全错。',
  '5-灵感/杂记.md': '今天聊到 AI 剪辑，顺便记一下。剪辑剪辑剪辑剪辑剪辑剪辑',
  '3-资源/工具清单.md': '剪映、CapCut',
  '2-领域/人生/日记.md': 'AI 剪辑 私人内容',
  '5-灵感/.hidden/藏.md': 'AI 剪辑',
  'MediaPilot/项目/旧项目.md': '<!-- mediapilot:start -->\n# 旧项目 AI 剪辑\n<!-- mediapilot:end -->',
};
const cfgOf = (vault: string) => ({ vault, readFolders: ['5-灵感', '3-资源'] });

describe('notes vault', () => {
  it('lists only readable folders plus MediaPilot, skipping hidden dirs', async () => {
    const v = await makeVault(FILES);
    expect((await listReadableNotes(cfgOf(v))).sort()).toEqual(['3-资源/工具清单.md', '5-灵感/AI 剪辑翻车.md', '5-灵感/杂记.md', 'MediaPilot/项目/旧项目.md']);
  });
  it('ranks title hits above body hits and returns a snippet', async () => {
    const v = await makeVault(FILES);
    const hits = await searchNotes(cfgOf(v), '剪辑 翻车');
    expect(hits[0]).toMatchObject({ path: '5-灵感/AI 剪辑翻车.md', title: 'AI 剪辑翻车' });
    expect(hits[0].snippet).toContain('翻车了三次');
    expect(hits.map((h) => h.path)).not.toContain('2-领域/人生/日记.md');
  });
  it('returns nothing for words that appear nowhere', async () => {
    const v = await makeVault(FILES);
    expect(await searchNotes(cfgOf(v), '量子计算')).toEqual([]);
  });
  it('refuses paths outside readable folders', async () => {
    const v = await makeVault(FILES);
    await expect(readNote(cfgOf(v), '2-领域/人生/日记.md')).rejects.toThrow('这篇笔记不在允许读取的文件夹里');
    await expect(readNote(cfgOf(v), '5-灵感/../2-领域/人生/日记.md')).rejects.toThrow('这篇笔记不在允许读取的文件夹里');
    await expect(readNote(cfgOf(v), '5-灵感/.hidden/藏.md')).rejects.toThrow('这篇笔记不在允许读取的文件夹里');
  });
  it('never follows symlinks out of readable folders', async () => {
    const v = await makeVault(FILES);
    await fs.symlink(path.join(v, '2-领域/人生/日记.md'), path.join(v, '5-灵感/链接.md'));
    await fs.symlink(path.join(v, '2-领域/人生'), path.join(v, '5-灵感/人生链接'));
    expect(await listReadableNotes(cfgOf(v))).not.toContain('5-灵感/链接.md');
    expect((await searchNotes(cfgOf(v), '私人')).length).toBe(0);
    await expect(readNote(cfgOf(v), '5-灵感/链接.md')).rejects.toThrow('这篇笔记不在允许读取的文件夹里');
  });
  it('truncates long notes', async () => {
    const v = await makeVault({ '5-灵感/长.md': '字'.repeat(7000) });
    const n = await readNote(cfgOf(v), '5-灵感/长.md');
    expect(n.text.length).toBeLessThan(6100);
    expect(n.text).toContain('（已截断，全文 7000 字）');
  });
  it('reports a missing vault', async () => {
    await expect(searchNotes({ vault: '/nonexistent/vault', readFolders: [] }, 'x')).rejects.toThrow(NotesError);
    await expect(searchNotes({ vault: null, readFolders: [] }, 'x')).rejects.toThrow('没找到 Obsidian 库：去设置页填库路径');
  });
});
