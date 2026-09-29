import type { Command } from './registry';
import { FILM_COMMANDS } from './commands/film';
import { READ_COMMANDS } from './commands/read';
import { WRITE_COMMANDS } from './commands/write';

export const ALL_COMMANDS: Command[] = [...FILM_COMMANDS, ...READ_COMMANDS, ...WRITE_COMMANDS];
