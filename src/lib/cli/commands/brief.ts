import { buildBrief, loadBriefInput } from '../brief';
import type { Command } from '../registry';

export const BRIEF_COMMAND: Command = {
  path: ['brief'],
  tier: 'read',
  hermes: true,
  usage: 'mp brief',
  summary: '每日简报',
  run: async (ctx) => ({ text: buildBrief(await loadBriefInput(ctx.db, ctx.now)) }),
  format: (d) => (d as { text: string }).text,
};
