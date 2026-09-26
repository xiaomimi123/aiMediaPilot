import type { PrismaClient, Prisma } from '@prisma/client';
import type { Tool, ToolContext, ToolResult } from '@/lib/tools/types';
import { toToolSpec, type AgentMessage, type ChatModel, type ChatTurnResult, type ToolCall } from './chat-model';
import { buildSystemPrompt, loadHistory } from './context';

export const MAX_TOOL_CALLS_PER_TURN = 8;
/** 模型调用硬上限: 工具用满后还要一次文字收尾, 再留一次余量。防止模型失控时无限调用、持续扣费。 */
export const MAX_MODEL_CALLS_PER_TURN = MAX_TOOL_CALLS_PER_TURN + 2;

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
    return { ok: false, summary: `${tool.label}：编导给的参数不对，已让它重试`, data: { error: '参数必须是合法 JSON，请重新调用' } };
  }
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    // 原始 zod 报错只回给模型; 用户只看到一句中文
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(根)'}：${i.message}`).join('；');
    return { ok: false, summary: `${tool.label}：编导给的参数不对，已让它重试`, data: { error: detail } };
  }
  try {
    return await tool.execute(ctx, parsed.data);
  } catch (e) {
    return { ok: false, summary: `${tool.label}失败：${errMsg(e)}`, data: { error: errMsg(e) } };
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
  const { projectId, db } = opts;
  // 浏览器中途关页/刷新后 emit 会抛错; 吞掉它, 让这一轮照常跑完并把结果存库 —— 不能被误判成"连不上 DeepSeek"
  const emit = (e: AgentEvent) => {
    try {
      opts.emit(e);
    } catch {
      // 客户端已断开
    }
  };
  await db.chatMessage.create({ data: { projectId, role: 'user', content: opts.userText } });

  const messages: AgentMessage[] = [
    { role: 'system', content: await buildSystemPrompt(db, projectId) },
    ...(await loadHistory(db, projectId)),
  ];
  const specs = opts.tools.map((t) => toToolSpec(t));
  let used = 0;
  let modelCalls = 0;

  for (;;) {
    if (modelCalls >= MAX_MODEL_CALLS_PER_TURN) {
      const message = `这一轮编导调用次数过多（${MAX_MODEL_CALLS_PER_TURN} 次），已强制停止。稿子里已完成的修改保留着，换个说法再发一次。`;
      await db.chatMessage.create({ data: { projectId, role: 'system', content: message } });
      emit({ type: 'error', message });
      return;
    }
    modelCalls += 1;
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
