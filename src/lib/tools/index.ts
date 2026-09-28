import type { Tool } from './types';
import { writeScriptTool } from './write-script';
import { patchScriptTool } from './patch-script';
import { transcribeTool } from './transcribe';
import { suggestTopicsTool } from './suggest-topics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SCRIPT_TOOLS: Tool<any>[] = [writeScriptTool, patchScriptTool, transcribeTool, suggestTopicsTool];
