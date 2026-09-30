import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { Tool } from './types';
import { getNotesConfig, type NotesConfig } from '@/lib/notes/config';
import { readNote, searchNotes } from '@/lib/notes/vault';
import { proposeProjectNote } from '@/lib/notes/proposals';
import { formatHitsText } from '@/lib/cli/commands/notes';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const SearchInput = z.object({ query: z.string().min(1).describe('关键词, 多个用空格隔开') });
const ReadInput = z.object({ path: z.string().min(1).describe('search_notes 返回的笔记路径') });
const ProposeInput = z.object({ summary: z.string().max(200).optional().describe('一两句编导小结, 可不填') });

export function makeNotesTools(getCfg: (db: PrismaClient) => Promise<NotesConfig> = (db) => getNotesConfig(db)) {
  const search: Tool<z.infer<typeof SearchInput>> = {
    name: 'search_notes',
    label: '搜笔记',
    description: '在用户 Obsidian 里允许读取的文件夹中按关键词搜笔记，返回路径、标题和命中片段。写稿前用来找用户自己的观点、案例和经历。',
    input: SearchInput,
    async execute(ctx, { query }) {
      try {
        const hits = await searchNotes(await getCfg(ctx.db), query);
        return { ok: true, summary: `搜笔记「${query}」：找到 ${hits.length} 篇`, data: { text: formatHitsText(hits), hits } };
      } catch (e) {
        return { ok: false, summary: `搜笔记失败：${msg(e)}`, data: { error: msg(e) } };
      }
    },
  };
  const read: Tool<z.infer<typeof ReadInput>> = {
    name: 'read_note',
    label: '读笔记',
    description: '读取一篇用户笔记的全文（路径来自 search_notes）。',
    input: ReadInput,
    async execute(ctx, { path }) {
      try {
        const n = await readNote(await getCfg(ctx.db), path);
        return { ok: true, summary: `读笔记：${n.title}`, data: { text: n.text, path: n.path } };
      } catch (e) {
        return { ok: false, summary: `读笔记失败：${msg(e)}`, data: { error: msg(e) } };
      }
    },
  };
  const propose: Tool<z.infer<typeof ProposeInput>> = {
    name: 'propose_note',
    label: '提议存进 Obsidian',
    description: '用户要把这个项目存进笔记 / Obsidian 时调用：产品会在对话里放一张确认卡片，用户点确认才写。可附一两句编导小结。',
    input: ProposeInput,
    async execute(ctx, { summary }) {
      await proposeProjectNote(ctx.db, ctx.projectId, 'manual', summary ?? null);
      return { ok: true, summary: '已提议存进 Obsidian，等你在卡片上确认' };
    },
  };
  return [search, read, propose] as const;
}

export const [searchNotesTool, readNoteTool, proposeNoteTool] = makeNotesTools();
