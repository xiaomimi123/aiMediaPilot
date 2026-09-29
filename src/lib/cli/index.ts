import type { Command } from './registry';
import { FILM_COMMANDS } from './commands/film';

export const ALL_COMMANDS: Command[] = [...FILM_COMMANDS];
