import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { toAnthropicMessages, createAnthropicChat, createAnthropicLLM } from '@/lib/llm/anthropic';
import type { AgentMessage } from '@/lib/agent/chat-model';

const cfg = { baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-x', model: 'claude-x', label: 'Claude（claude-x）' };

describe('toAnthropicMessages', () => {
  it('pulls out the system prompt and converts tool calls and results', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: '你是编导' },
      { role: 'user', content: '写一版' },
      { role: 'assistant', content: '好的', tool_calls: [{ id: 't1', type: 'function', function: { name: 'write_script', arguments: '{"direction":"x"}' } }] },
      { role: 'tool', tool_call_id: 't1', content: '{"ok":true}' },
    ];
    const r = toAnthropicMessages(msgs);
    expect(r.system).toBe('你是编导');
    expect(r.messages).toEqual([
      { role: 'user', content: '写一版' },
      { role: 'assistant', content: [{ type: 'text', text: '好的' }, { type: 'tool_use', id: 't1', name: 'write_script', input: { direction: 'x' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' }] },
    ]);
  });
  it('merges consecutive tool results into one user message', () => {
    const r = toAnthropicMessages([
      { role: 'user', content: 'x' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'f', arguments: '{}' } }, { id: 'b', type: 'function', function: { name: 'g', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'a', content: '1' },
      { role: 'tool', tool_call_id: 'b', content: '2' },
    ]);
    expect(r.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '1' }, { type: 'tool_result', tool_use_id: 'b', content: '2' }] });
  });
  it('starts with a user message', () => {
    const r = toAnthropicMessages([{ role: 'system', content: 's' }, { role: 'assistant', content: '（已执行 write_script：写稿）' }, { role: 'user', content: '再短点' }]);
    expect(r.messages[0].role).toBe('user');
    expect(r.messages.at(-1)).toEqual({ role: 'user', content: '再短点' });
  });
  it('keeps unparseable tool arguments as raw text so the loop can report it', () => {
    const r = toAnthropicMessages([{ role: 'user', content: 'x' }, { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'f', arguments: '{bad' } }] }]);
    expect((r.messages[1].content as { input: unknown }[])[0].input).toEqual({ _raw: '{bad' });
  });
});

describe('createAnthropicChat', () => {
  it('streams text and accumulates streamed tool input', async () => {
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '写' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '好了' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'write_script', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"direc' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'tion":"x"}' } },
      { type: 'message_stop' },
    ];
    const stream = vi.fn(async () => (async function* () { yield* events; })());
    const chat = createAnthropicChat(cfg, { stream });
    const deltas: string[] = [];
    const r = await chat.streamTurn([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], [{ name: 'write_script', description: 'd', parameters: { type: 'object', properties: {} } }], (d) => deltas.push(d));
    expect(deltas.join('')).toBe('写好了');
    expect(r).toEqual({ text: '写好了', toolCalls: [{ id: 'tu1', name: 'write_script', arguments: '{"direction":"x"}' }] });
    const params = (stream.mock.calls[0] as unknown[])[0] as { system: string; tools: unknown[]; model: string };
    expect(params).toMatchObject({ system: 's', model: 'claude-x' });
    expect(params.tools).toEqual([{ name: 'write_script', description: 'd', input_schema: { type: 'object', properties: {} } }]);
  });
  it('omits tools when there are none', async () => {
    const stream = vi.fn(async () => (async function* () {})());
    await createAnthropicChat(cfg, { stream }).streamTurn([{ role: 'user', content: 'u' }], [], () => {});
    expect(((stream.mock.calls[0] as unknown[])[0] as Record<string, unknown>).tools).toBeUndefined();
  });
});

describe('createAnthropicLLM', () => {
  it('forces a tool call and validates its input with the schema', async () => {
    const create = vi.fn(async () => ({ content: [{ type: 'tool_use', id: 'x', name: 'respond', input: { city: '北京', country: '中国' } }], usage: { input_tokens: 10, output_tokens: 5 } }));
    const llm = createAnthropicLLM(cfg, { create });
    const { result } = await llm.callStructured({ systemPrompt: 's', userMessage: [{ type: 'text', text: 'u' }], responseSchema: z.object({ city: z.string(), country: z.string() }) });
    expect(result).toEqual({ city: '北京', country: '中国' });
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({ tool_choice: { type: 'tool', name: 'respond' }, system: 's' });
  });
  it('retries once then fails when the output does not match', async () => {
    const create = vi.fn(async () => ({ content: [{ type: 'tool_use', id: 'x', name: 'respond', input: { city: 1 } }] }));
    await expect(createAnthropicLLM(cfg, { create }).callStructured({ systemPrompt: 's', userMessage: [{ type: 'text', text: 'u' }], responseSchema: z.object({ city: z.string() }) })).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
