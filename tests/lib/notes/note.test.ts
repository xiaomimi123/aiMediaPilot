import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildRegion, noteFileName, renderFile, retroBlocks, ownerOf, writeProjectNote, START, END, type NoteSource } from '@/lib/notes/note';
import { makeVault } from './fixture';

const src = (over: Partial<NoteSource> = {}): NoteSource => ({
  projectId: 'cmabc123456',
  title: 'U盘干到品类第一',
  stage: 'scripted',
  topic: '小品类也能做到第一',
  benchmark: { author: '添叔AI雷达', digg: 4008, ratio: 8.6, url: 'https://www.douyin.com/video/1' },
  segments: [{ label: '开场钩子', text: '一个 U 盘能卖到第一？' }],
  retro: null,
  pastRetroBlocks: [],
  lessons: [],
  summary: null,
  ...over,
});
const meta = { projectId: 'cmabc123456', stage: 'scripted', today: '2026-09-30' };

describe('note content', () => {
  it('builds the region from product data', () => {
    const r = buildRegion(src());
    expect(r).toContain('# U盘干到品类第一');
    expect(r).toContain('## 选题\n小品类也能做到第一');
    expect(r).toContain('## 对标\n添叔AI雷达 · 4,008 赞（平时的 8.6 倍） · https://www.douyin.com/video/1');
    expect(r).toContain('## 定稿\n### 开场钩子\n一个 U 盘能卖到第一？');
    expect(r).not.toContain('## 复盘');
    expect(r).not.toContain('## 编导小结');
  });
  it('omits the benchmark and uses the title as topic when there is none', () => {
    const r = buildRegion(src({ benchmark: null, topic: null }));
    expect(r).toContain('## 选题\nU盘干到品类第一');
    expect(r).not.toContain('## 对标');
  });
  it('renders retro, lessons and the editor summary', () => {
    const r = buildRegion(src({
      retro: { dayN: 3, viewCount: 1200, likeCount: 30, stages: [{ label: '开头 2 秒', verdict: 'bad', note: '跳出高' }], narrative: '开头太慢' },
      lessons: [{ text: '第一句直接说结果', status: 'active' }, { text: '少用术语', status: 'candidate' }],
      summary: '这条靠对比撑住了。',
    }));
    expect(r).toContain('## 复盘\n### 第 3 天 · 播放 1,200 · 点赞 30\n- 差 开头 2 秒：跳出高\n编导解读：开头太慢');
    expect(r).toContain('## 写法经验\n- 第一句直接说结果（已采纳）\n- 少用术语（待决定）');
    expect(r).toContain('## 编导小结\n这条靠对比撑住了。');
  });
  it('keeps earlier retro days ordered by day', () => {
    const day3 = retroBlocks(buildRegion(src({ retro: { dayN: 3, viewCount: 1, likeCount: 1, stages: [], narrative: null } })));
    expect(day3).toHaveLength(1);
    const r = buildRegion(src({ retro: { dayN: 7, viewCount: 2, likeCount: 2, stages: [], narrative: null }, pastRetroBlocks: day3 }));
    expect(r.indexOf('### 第 3 天')).toBeLessThan(r.indexOf('### 第 7 天'));
    expect(retroBlocks(r)).toHaveLength(2);
  });
  it('makes a safe file name', () => {
    expect(noteFileName('A/B: C?')).toBe('MediaPilot/项目/AB C.md');
    expect(noteFileName('  ')).toBe('MediaPilot/项目/未命名项目.md');
  });
});

describe('note file', () => {
  it('creates front-matter and region for a new file', () => {
    const f = renderFile(null, meta, 'X');
    expect(f).toBe(`---\nmediapilot_id: cmabc123456\nstage: scripted\nupdated: 2026-09-30\ntags: [mediapilot]\n---\n${START}\nX\n${END}\n`);
    expect(ownerOf(f)).toBe('cmabc123456');
  });
  it('keeps content outside the marked region', () => {
    const old = `${renderFile(null, meta, 'OLD')}\n## 我的想法\n下次试试反问开头\n`;
    const f = renderFile(old, { ...meta, stage: 'published', today: '2026-10-07' }, 'NEW');
    expect(f).toContain(`${START}\nNEW\n${END}`);
    expect(f).not.toContain('OLD');
    expect(f).toContain('## 我的想法\n下次试试反问开头');
    expect(f).toContain('stage: published');
    expect(f).toContain('updated: 2026-10-07');
  });
  it('treats files without markers as the user own', () => {
    expect(ownerOf('# 我自己写的')).toBeNull();
  });
  it('writes into MediaPilot and beside a foreign file with the same name', async () => {
    const v = await makeVault({ 'MediaPilot/项目/同名.md': '# 我自己写的' });
    const cfg = { vault: v, readFolders: [] };
    const rel = await writeProjectNote(cfg, 'MediaPilot/项目/同名.md', meta, 'R');
    expect(rel).toBe('MediaPilot/项目/同名-123456.md');
    expect(await fs.readFile(path.join(v, 'MediaPilot/项目/同名.md'), 'utf8')).toBe('# 我自己写的');
    expect(await fs.readFile(path.join(v, rel), 'utf8')).toContain(`${START}\nR\n${END}`);
    // 同一项目再写: 仍写到带 id 的那篇
    expect(await writeProjectNote(cfg, 'MediaPilot/项目/同名.md', meta, 'R2')).toBe(rel);
  });
  it('refuses paths outside MediaPilot and a missing vault', async () => {
    const v = await makeVault({});
    await expect(writeProjectNote({ vault: v, readFolders: [] }, '5-灵感/x.md', meta, 'R')).rejects.toThrow('只能写进 MediaPilot 文件夹');
    await expect(writeProjectNote({ vault: v, readFolders: [] }, 'MediaPilot/../x.md', meta, 'R')).rejects.toThrow('只能写进 MediaPilot 文件夹');
    await expect(writeProjectNote({ vault: null, readFolders: [] }, 'MediaPilot/项目/a.md', meta, 'R')).rejects.toThrow('没找到 Obsidian 库：去设置页填库路径');
  });
});
