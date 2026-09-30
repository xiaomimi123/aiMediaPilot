import { describe, expect, it } from 'vitest';
import { FILM_COMMANDS } from '@/lib/cli/commands/film';

describe('film commands', () => {
  it('keeps the existing command set, heavy and not for hermes', () => {
    expect(FILM_COMMANDS.map((c) => c.path.join(' '))).toEqual(['project list', 'project export', 'film new', 'film check', 'film render', 'film register']);
    expect(FILM_COMMANDS.filter((c) => c.hermes).map((c) => c.path.join(' '))).toEqual(['project list']);
  });
  it('project list keeps the tab-separated text format', () => {
    const list = FILM_COMMANDS[0];
    expect(list.format!([{ id: 'p1', stage: 'final', title: 'U盘' }])).toBe('p1\tfinal\tU盘');
  });
});
