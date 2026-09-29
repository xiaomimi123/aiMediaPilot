import type { Command } from './registry';
import { FILM_COMMANDS } from './commands/film';
import { READ_COMMANDS } from './commands/read';

export const ALL_COMMANDS: Command[] = [...FILM_COMMANDS, ...READ_COMMANDS];
