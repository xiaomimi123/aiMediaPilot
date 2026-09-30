import { runAgentTurn, type AgentEvent } from '@/lib/agent/loop';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import { SCRIPT_TOOLS } from '@/lib/tools';
import { CliError, needArg, type Command, type CommandCtx } from '../registry';

/** 与网页对话同一套循环、同一份记录; 编导回复流式写 stdout, 工具结果写 stderr */
export async function runChat(ctx: CommandCtx, projectId: string, text: string, deps: { turn?: typeof runAgentTurn } = {}) {
  const m = await getActiveModel(ctx.db);
  if (!m) throw new CliError('no_model', NO_MODEL_MESSAGE);
  if (!(await ctx.db.project.findUnique({ where: { id: projectId }, select: { id: true } }))) throw new CliError('not_found', '找不到这个项目。');
  let reply = '';
  const tools: { name: string; ok: boolean; summary: string }[] = [];
  let error: string | null = null;
  await (deps.turn ?? runAgentTurn)({
    projectId,
    userText: text,
    db: ctx.db,
    model: m.chat,
    tools: SCRIPT_TOOLS,
    toolCtx: { projectId, db: ctx.db, llm: m.llm },
    emit: (e: AgentEvent) => {
      if (e.type === 'text') {
        reply += e.delta;
        ctx.write(e.delta);
      } else if (e.type === 'tool') {
        tools.push({ name: e.name, ok: e.ok, summary: e.summary });
        ctx.progress(`${e.ok ? '✓' : '✗'} ${e.summary}`);
      } else if (e.type === 'error') error = e.message;
    },
  });
  if (error) throw new CliError('failed', error);
  return { reply, tools };
}

export const CHAT_COMMAND: Command = {
  path: ['chat'],
  tier: 'write',
  hermes: false,
  usage: 'mp chat <项目> <消息>',
  summary: '和编导对话(写稿/改稿)',
  async run(ctx, p) {
    const id = needArg(p, 0, '项目');
    const text = p.positionals.slice(1).join(' ').trim();
    if (!text) throw new CliError('bad_args', '缺少参数：消息');
    return runChat(ctx, id, text);
  },
  // 回复已经流式写过了, 结尾只补一个换行
  format: () => '',
};
