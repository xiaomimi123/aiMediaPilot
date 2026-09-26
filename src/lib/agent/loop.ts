import type { PrismaClient, Prisma } from '@prisma/client';
import type { Tool, ToolContext, ToolResult } from '@/lib/tools/types';
import { toToolSpec, type AgentMessage, type ChatModel, type ChatTurnResult, type ToolCall } from './chat-model';
import { buildSystemPrompt, loadHistory } from './context';

export const MAX_TOOL_CALLS_PER_TURN = 8;

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; ok: boolean; summary: string; segmentIds: string[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeToolCall(call: ToolCall, tools: Tool<any>[], ctx: ToolContext): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { ok: false, summary: `没有叫 ${call.name} 的工具`, data: { error: `可用工具：${tools.map((t) => t.name).join('、')}` } };
  let args: unknown;
  try {
    args = JSON.parse(call.arguments || '{}');
  } catch {
    return { ok: false, summary: `${call.name} 参数不对：不是合法 JSON`, data: { error: '参数必须是合法 JSON，请重新调用' } };
  }
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(根)'}：${i.message}`).join('；');
    return { ok: false, summary: `${call.name} 参数不对：${detail}`, data: { error: detail } };
  }
  try {
    return await tool.execute(ctx, parsed.data);
  } catch (e) {
    return { ok: false, summary: `${call.name} 失败：${errMsg(e)}`, data: { error: errMsg(e) } };
  }
}

function safeJson(s: string): Prisma.InputJsonValue {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return { raw: s };
  }
}

export async function runAgentTurn(opts: {
  projectId: string;
  userText: string;
  db: PrismaClient;
  model: ChatModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Tool<any>[];
  toolCtx: ToolContext;
  emit: (e: AgentEvent) => void;
}): Promise<void> {
  const { projectId, db, emit } = opts;
  await db.chatMessage.create({ data: { projectId, role: 'user', content: opts.userText } });

  const messages: AgentMessage[] = [
    { role: 'system', content: await buildSystemPrompt(db, projectId) },
    ...(await loadHistory(db, projectId)),
  ];
  const specs = opts.tools.map((t) => toToolSpec(t));
  let used = 0;

  for (;;) {
    // 用满上限后不再给工具, 模型只能用文字收尾
    const offerTools = used < MAX_TOOL_CALLS_PER_TURN;
    let turn: ChatTurnResult;
    try {
      turn = await opts.model.streamTurn(messages, offerTools ? specs : [], (delta) => emit({ type: 'text', delta }));
    } catch (e) {
      const message = `编导暂时连不上 DeepSeek（${errMsg(e)}）。检查 .env 里的 DEEPSEEK_API_KEY 和网络后再发一次。`;
      await db.chatMessage.create({ data: { projectId, role: 'system', content: message } });
      emit({ type: 'error', message });
      return;
    }

    if (turn.toolCalls.length === 0) {
      await db.chatMessage.create({ data: { projectId, role: 'assistant', content: turn.text } });
      emit({ type: 'done' });
      return;
    }

    if (turn.text) await db.chatMessage.create({ data: { projectId, role: 'assistant', content: turn.text } });
    messages.push({
      role: 'assistant',
      content: turn.text || null,
      tool_calls: turn.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })),
    });

    for (const call of turn.toolCalls) {
      used += 1;
      const result: ToolResult =
        used > MAX_TOOL_CALLS_PER_TURN
          ? { ok: false, summary: '本轮工具调用次数已到上限', data: { error: `本轮最多调用 ${MAX_TOOL_CALLS_PER_TURN} 次工具，已停止。请把目前的进展和剩下的问题如实告诉用户。` } }
          : await executeToolCall(call, opts.tools, opts.toolCtx);
      await db.chatMessage.create({
        data: {
          projectId,
          role: 'tool',
          content: result.summary,
          toolName: call.name,
          toolInput: safeJson(call.arguments),
          toolResult: { ok: result.ok, summary: result.summary, data: (result.data ?? null) as Prisma.InputJsonValue, segmentIds: result.segmentIds ?? [] },
        },
      });
      emit({ type: 'tool', name: call.name, ok: result.ok, summary: result.summary, segmentIds: result.segmentIds ?? [] });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: result.ok, summary: result.summary, data: result.data ?? null }) });
    }
  }
}
