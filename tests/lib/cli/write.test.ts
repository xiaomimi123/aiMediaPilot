import { describe, expect, it } from 'vitest';
import { WRITE_COMMANDS } from '@/lib/cli/commands/write';
import { READ_COMMANDS } from '@/lib/cli/commands/read';
import { FILM_COMMANDS } from '@/lib/cli/commands/film';
import { BRIEF_COMMAND } from '@/lib/cli/commands/brief';
import { CHAT_COMMAND } from '@/lib/cli/commands/chat';

describe('write commands', () => {
  it('have the agreed tiers and hermes permissions', () => {
    expect(WRITE_COMMANDS.map((c) => [c.path.join(' '), c.tier, c.hermes])).toEqual([
      ['topics ignore', 'write', true], ['topics follow', 'write', false], ['topics unfollow', 'write', false],
      ['topics paste', 'douyin', false], ['topics analyze', 'douyin', false], ['topics search', 'douyin', false],
      ['project new', 'write', true], ['script finalize', 'write', false], ['publish kit', 'write', false], ['publish link', 'write', true],
      ['retro run', 'write', false], ['lessons adopt', 'write', true], ['lessons reject', 'write', true], ['lessons retire', 'write', false], ['tasks run', 'douyin', false],
    ]);
  });
  it('hermes can reach exactly the spec list', () => {
    const allowed = [...FILM_COMMANDS, ...READ_COMMANDS, ...WRITE_COMMANDS, CHAT_COMMAND, BRIEF_COMMAND].filter((c) => c.hermes).map((c) => c.path.join(' ')).sort();
    expect(allowed).toEqual(
      ['brief', 'lessons adopt', 'lessons list', 'lessons reject', 'project list', 'project new', 'project show', 'publish candidates', 'publish link', 'retro show', 'status', 'tasks status', 'topics accounts', 'topics hits', 'topics ignore', 'topics show', 'topics suggest'].sort(),
    );
  });
});
