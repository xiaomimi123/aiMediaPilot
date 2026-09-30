import { describe, expect, it } from 'vitest';
import { NOTES_COMMANDS, formatHitsText } from '@/lib/cli/commands/notes';

describe('mp notes', () => {
  it('is readable by claude-code but not by hermes', () => {
    expect(NOTES_COMMANDS.map((c) => [c.path.join(' '), c.tier, c.hermes])).toEqual([['notes search', 'read', false], ['notes show', 'read', false]]);
  });
  it('formats hits', () => {
    expect(formatHitsText([{ path: '5-灵感/a.md', title: 'a', snippet: '片段', mtime: '2026-09-30T00:00:00.000Z' }])).toBe('[5-灵感/a.md] a：片段');
    expect(formatHitsText([])).toBe('笔记里没找到相关内容。');
  });
});
