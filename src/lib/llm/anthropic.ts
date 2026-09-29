import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodSchema } from 'zod';
import type { AgentMessage, ChatModel, ToolCall } from '@/lib/agent/chat-model';
import type { StructuredLLM } from '@/lib/script/write';
import type { CallStructuredOpts, TokenUsage } from './vision';

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown } | { type: 'tool_result'; tool_use_id: string; content: string };
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Block[];
}

export type AnthropicStreamFn = (params: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>;
export type AnthropicCreateFn = (params: Record<string, unknown>) => Promise<{ content: Record<string, unknown>[]; usage?: { input_tokens: number; output_tokens: number } }>;

interface Cfg {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

const MAX_TOKENS = 4096;

const asBlocks = (c: string | Block[]): Block[] => (typeof c === 'string' ? (c ? [{ type: 'text', text: c }] : []) : c);

function parseArgs(s: string): unknown {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return { _raw: s };
  }
}

/** OpenAI 格式的对话 → Claude 格式: system 单独; 工具结果放进 user; 同角色相邻合并; 首条必须是 user */
export function toAnthropicMessages(messages: AgentMessage[]): { system: string; messages: AnthropicMessage[] } {
  const system: string[] = [];
  const out: AnthropicMessage[] = [];
  const push = (m: AnthropicMessage) => {
    const last = out.at(-1);
    if (last && last.role === m.role) last.content = [...asBlocks(last.content), ...asBlocks(m.content)];
    else out.push(m);
  };
  for (const m of messages) {
    if (m.role === 'system') {
      system.push(typeof m.content === 'string' ? m.content : '');
    } else if (m.role === 'user') {
      push({ role: 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
    } else if (m.role === 'assistant') {
      const text = typeof m.content === 'string' ? m.content : '';
      const calls = 'tool_calls' in m && m.tool_calls ? m.tool_calls : [];
      if (!calls.length) {
        if (text) push({ role: 'assistant', content: text });
        continue;
      }
      push({
        role: 'assistant',
        content: [...(text ? [{ type: 'text' as const, text }] : []), ...calls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }))],
      });
    } else if (m.role === 'tool') {
      push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] });
    }
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '（以下是之前的对话）' });
  return { system: system.join('\n\n'), messages: out };
}

function client(c: Cfg) {
  return new Anthropic({ apiKey: c.apiKey || 'none', baseURL: c.baseUrl });
}

export function createAnthropicChat(c: Cfg, deps: { stream?: AnthropicStreamFn } = {}): ChatModel {
  const stream: AnthropicStreamFn =
    deps.stream ?? (async (params) => (await client(c).messages.create({ ...(params as object), stream: true } as never)) as unknown as AsyncIterable<Record<string, unknown>>);
  return {
    label: c.label,
    async streamTurn(messages, tools, onText) {
      const { system, messages: msgs } = toAnthropicMessages(messages);
      const events = await stream({
        model: c.model,
        max_tokens: MAX_TOKENS,
        ...(system ? { system } : {}),
        messages: msgs,
        ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      });
      let text = '';
      const calls = new Map<number, ToolCall>();
      for await (const ev of events) {
        const index = ev.index as number;
        if (ev.type === 'content_block_start') {
          const b = ev.content_block as { type: string; id?: string; name?: string };
          if (b.type === 'tool_use') calls.set(index, { id: b.id ?? '', name: b.name ?? '', arguments: '' });
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta as { type: string; text?: string; partial_json?: string };
          if (d.type === 'text_delta' && d.text) {
            text += d.text;
            onText(d.text);
          } else if (d.type === 'input_json_delta' && d.partial_json !== undefined) {
            const slot = calls.get(index);
            if (slot) slot.arguments += d.partial_json;
          }
        }
      }
      return { text, toolCalls: [...calls.values()].map((t) => ({ ...t, arguments: t.arguments || '{}' })) };
    },
  };
}

export function createAnthropicLLM(c: Cfg, deps: { create?: AnthropicCreateFn } = {}): StructuredLLM {
  const create: AnthropicCreateFn = deps.create ?? (async (params) => (await client(c).messages.create(params as never)) as never);
  return {
    async callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: TokenUsage }> {
      const schema = zodToJsonSchema(opts.responseSchema as ZodSchema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>;
      delete schema.$schema;
      const text = opts.userMessage.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
      let lastError: unknown;
      // 结构化输出 = 强制调用一个参数即目标 schema 的工具; 校验不过重试一次
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await create({
          model: opts.model ?? c.model,
          max_tokens: opts.maxTokens ?? MAX_TOKENS,
          system: opts.systemPrompt,
          messages: [{ role: 'user', content: text }],
          tools: [{ name: 'respond', description: '按要求的格式交回结果', input_schema: schema }],
          tool_choice: { type: 'tool', name: 'respond' },
        });
        const block = r.content.find((b) => b.type === 'tool_use');
        const parsed = opts.responseSchema.safeParse(block?.input);
        if (parsed.success) {
          return { result: parsed.data, usage: { model: c.model, promptTokens: r.usage?.input_tokens ?? 0, completionTokens: r.usage?.output_tokens ?? 0, estCostUSD: 0 } };
        }
        lastError = parsed.error;
      }
      throw new Error(`${c.label} 没按格式交回结果：${lastError instanceof Error ? lastError.message.slice(0, 200) : String(lastError)}`);
    },
  };
}
