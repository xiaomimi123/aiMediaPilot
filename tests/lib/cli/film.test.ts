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
  it('film check says which orientation passed', () => {
    const check = FILM_COMMANDS.find((c) => c.path.join(' ') === 'film check')!;
    expect(check.format!({ passed: true, orientation: 'landscape' })).toBe('film check 通过（横版）');
    expect(check.format!({ passed: true, orientation: 'portrait' })).toBe('film check 通过（竖版）');
    expect(check.usage).toBe('mp film check <片子目录> [--expect landscape|portrait]');
    expect(FILM_COMMANDS.find((c) => c.path.join(' ') === 'film new')!.usage).toBe('mp film new <项目> [--landscape]');
  });
});
