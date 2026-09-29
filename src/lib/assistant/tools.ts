import { z } from 'zod';
import type { Tool } from '@/lib/tools/types';
import { toCliError, type Command, type CommandCtx } from '@/lib/cli/registry';
import { loadSkillTool } from './skills';

/** 出片要在 Claude Code 里做; 装 Hermes 改用户系统 —— 不给总助手 */
export const ASSISTANT_EXCLUDED = ['film new', 'film check', 'film render', 'film register', 'project export', 'agents install-hermes'];

export const toolName = (cmd: Command) => cmd.path.join('_');

const Input = z.object({
  args: z.array(z.string()).optional().describe('位置参数, 按用法里的顺序, 如 ["项目id", "消息"]'),
  flags: z.record(z.union([z.string(), z.boolean()])).optional().describe('选项, 如 {"days": "7"} 或 {"json": true}'),
});

// 命令行里没写的开关 = false; Parsed 只认 true
const toFlags = (f: Record<string, string | boolean> = {}): Record<string, string | true> =>
  Object.fromEntries(Object.entries(f).filter((e): e is [string, string | true] => e[1] !== false));

const firstLine = (s: string) => (s.split('\n')[0] ?? '').slice(0, 60);

export function commandToTool(cmd: Command, now: () => Date = () => new Date()): Tool<z.infer<typeof Input>> {
  return {
    name: toolName(cmd),
    label: cmd.summary,
    description: `${cmd.summary}。用法：${cmd.usage}`,
    input: Input,
    async execute(ctx, input) {
      const cctx: CommandCtx = { db: ctx.db, agent: 'claude-code', now: now(), progress: () => {}, write: () => {} };
      try {
        const data = await cmd.run(cctx, { positionals: input.args ?? [], flags: toFlags(input.flags) });
        const text = cmd.format ? cmd.format(data) : JSON.stringify(data);
        return { ok: true, summary: `${cmd.summary}：${firstLine(text) || '完成'}`, data: { text, json: data } };
      } catch (e) {
        const err = toCliError(e);
        return { ok: false, summary: `${cmd.summary}失败：${firstLine(err.message)}`, data: { error: err.message } };
      }
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAssistantTools(cmds: Command[], skillsDir: string): Tool<any>[] {
  return [...cmds.filter((c) => !ASSISTANT_EXCLUDED.includes(c.path.join(' '))).map((c) => commandToTool(c)), loadSkillTool(skillsDir)];
}
