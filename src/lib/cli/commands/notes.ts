import { getNotesConfig } from '@/lib/notes/config';
import { readNote, searchNotes, NotesError, type NoteHit } from '@/lib/notes/vault';
import { CliError, needArg, type Command } from '../registry';

export function formatHitsText(hits: NoteHit[]): string {
  if (!hits.length) return '笔记里没找到相关内容。';
  return hits.map((h) => `[${h.path}] ${h.title}：${h.snippet}`).join('\n');
}

const wrap = async <T>(f: () => Promise<T>) => {
  try {
    return await f();
  } catch (e) {
    if (e instanceof NotesError) throw new CliError('not_found', e.message);
    throw e;
  }
};

/** 笔记只给 Claude Code 与总助手, 不给微信那边(hermes: false) */
export const NOTES_COMMANDS: Command[] = [
  {
    path: ['notes', 'search'],
    tier: 'read',
    hermes: false,
    usage: 'mp notes search <关键词…>',
    summary: '搜 Obsidian 笔记',
    run: (ctx, p) =>
      wrap(async () => {
        needArg(p, 0, '关键词');
        return searchNotes(await getNotesConfig(ctx.db), p.positionals.join(' '));
      }),
    format: (d) => formatHitsText(d as NoteHit[]),
  },
  {
    path: ['notes', 'show'],
    tier: 'read',
    hermes: false,
    usage: 'mp notes show <笔记路径>',
    summary: '读一篇 Obsidian 笔记',
    run: (ctx, p) => wrap(async () => readNote(await getNotesConfig(ctx.db), needArg(p, 0, '笔记路径'))),
    format: (d) => (d as { text: string }).text,
  },
];
