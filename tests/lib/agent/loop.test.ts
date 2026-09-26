import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runAgentTurn, MAX_TOOL_CALLS_PER_TURN, type AgentEvent } from '@/lib/agent/loop';
import type { ChatModel, ChatTurnResult } from '@/lib/agent/chat-model';
import type { Tool } from '@/lib/tools/types';
import { createFakeDb } from '../../helpers/fake-db';

function scriptedModel(turns: ChatTurnResult[] | (() => ChatTurnResult)): ChatModel & { seenTools: number[] } {
  const seenTools: number[] = [];
  return {
    seenTools,
    async streamTurn(_messages, tools, onText) {
      seenTools.push(tools.length);
      const t = typeof turns === 'function' ? turns() : turns.shift();
      if (!t) throw new Error('no more turns');
      if (t.text) onText(t.text);
      return t;
    },
  };
}

const echoTool: Tool<{ n: number }> = {
  name: 'echo',
  description: 'echo',
  input: z.object({ n: z.number() }),
  async execute(_ctx, input) {
    return { ok: true, summary: `echo ${input.n}`, segmentIds: ['s1'] };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(model: ChatModel, tools: Tool<any>[] = [echoTool]) {
  const { db, messages } = createFakeDb();
  const events: AgentEvent[] = [];
  await runAgentTurn({
    projectId: 'p1', userText: '你好', db, model, tools,
    toolCtx: { projectId: 'p1', db, llm: {} as never },
    emit: (e) => events.push(e),
  });
  return { events, messages };
}

describe('runAgentTurn', () => {
  it('plain text reply: streams, saves user + assistant, ends with done', async () => {
    const { events, messages } = await run(scriptedModel([{ text: '你好呀', toolCalls: [] }]));
    expect(events).toEqual([{ type: 'text', delta: '你好呀' }, { type: 'done' }]);
    expect(messages.map((m) => [m.role, m.content])).toEqual([['user', '你好'], ['assistant', '你好呀']]);
  });

  it('executes a tool call, emits tool event, then continues to final text', async () => {
    const { events, messages } = await run(
      scriptedModel([
        { text: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"n":3}' }] },
        { text: '好了', toolCalls: [] },
      ]),
    );
    expect(events).toContainEqual({ type: 'tool', name: 'echo', ok: true, summary: 'echo 3', segmentIds: ['s1'] });
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(messages.find((m) => m.role === 'tool')).toMatchObject({ toolName: 'echo', content: 'echo 3' });
  });

  it('invalid tool arguments are fed back, not thrown', async () => {
    const { events } = await run(
      scriptedModel([
        { text: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"n":"三"}' }] },
        { text: '参数错了我再试', toolCalls: [] },
      ]),
    );
    const tool = events.find((e) => e.type === 'tool');
    expect(tool).toMatchObject({ ok: false });
    expect((tool as { summary: string }).summary).toContain('参数不对');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('unknown tool name is fed back, not thrown', async () => {
    const { events } = await run(
      scriptedModel([
        { text: '', toolCalls: [{ id: 'c1', name: 'nope', arguments: '{}' }] },
        { text: '好', toolCalls: [] },
      ]),
    );
    expect(events.find((e) => e.type === 'tool')).toMatchObject({ ok: false, summary: '没有叫 nope 的工具' });
  });

  it('stops offering tools after MAX_TOOL_CALLS_PER_TURN and asks for a summary', async () => {
    let calls = 0;
    const model = scriptedModel(() =>
      calls++ < 20 ? { text: '', toolCalls: [{ id: `c${calls}`, name: 'echo', arguments: '{"n":1}' }] } : { text: '收尾', toolCalls: [] },
    );
    const { events } = await run(model);
    const toolEvents = events.filter((e) => e.type === 'tool');
    expect(toolEvents.filter((e) => (e as { ok: boolean }).ok)).toHaveLength(MAX_TOOL_CALLS_PER_TURN);
    expect(model.seenTools.at(-1)).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('model failure emits human error and keeps user message', async () => {
    const model: ChatModel = { async streamTurn() { throw new Error('401 Unauthorized'); } };
    const { events, messages } = await run(model);
    expect(events).toEqual([{ type: 'error', message: '编导暂时连不上 DeepSeek（401 Unauthorized）。检查 .env 里的 DEEPSEEK_API_KEY 和网络后再发一次。' }]);
    expect(messages[0]).toMatchObject({ role: 'user', content: '你好' });
    expect(messages.at(-1)).toMatchObject({ role: 'system' });
  });

  it('tool that throws becomes a readable failed result', async () => {
    const boom: Tool<Record<string, never>> = {
      name: 'boom', description: 'b', input: z.object({}),
      async execute() { throw new Error('磁盘满了'); },
    };
    const { events } = await run(
      scriptedModel([{ text: '', toolCalls: [{ id: 'c1', name: 'boom', arguments: '{}' }] }, { text: '抱歉', toolCalls: [] }]),
      [boom],
    );
    expect(events.find((e) => e.type === 'tool')).toMatchObject({ ok: false, summary: 'boom 失败：磁盘满了' });
  });
});
