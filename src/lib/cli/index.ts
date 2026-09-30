import type { Command } from './registry';
import { FILM_COMMANDS } from './commands/film';
import { READ_COMMANDS } from './commands/read';
import { WRITE_COMMANDS } from './commands/write';
import { CHAT_COMMAND } from './commands/chat';
import { BRIEF_COMMAND } from './commands/brief';
import { AGENTS_COMMAND } from './hermes';
import { NOTES_COMMANDS } from './commands/notes';
import { PREDICT_COMMANDS } from './commands/predict';

export const ALL_COMMANDS: Command[] = [...FILM_COMMANDS, ...READ_COMMANDS, ...NOTES_COMMANDS, ...PREDICT_COMMANDS, ...WRITE_COMMANDS, CHAT_COMMAND, BRIEF_COMMAND, AGENTS_COMMAND];
