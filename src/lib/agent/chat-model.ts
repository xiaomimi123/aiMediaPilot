import OpenAI from 'openai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tool } from '@/lib/tools/types';

export type AgentMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface ChatTurnResult {
  text: string;
  toolCalls: ToolCall[];
}
/** 对话模型接口 —— 测试注入假实现; 将来换 Claude API 只换这一层。 */
export interface ChatModel {
  streamTurn(messages: AgentMessage[], tools: ToolSpec[], onText: (delta: string) => void): Promise<ChatTurnResult>;
}

export function toToolSpec(tool: Tool<unknown>): ToolSpec {
  const { $schema: _drop, ...parameters } = zodToJsonSchema(tool.input, { $refStrategy: 'none' }) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, parameters };
}

export function createDeepSeekChatModel(apiKey: string, model = 'deepseek-chat'): ChatModel {
  const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1' });
  return {
    async streamTurn(messages, tools, onText) {
      const stream = await client.chat.completions.create({
        model,
        messages,
        stream: true,
        // 空数组会被 DeepSeek 拒绝, 没有工具时不传
        ...(tools.length
          ? { tools: tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } })) }
          : {}),
      });
      let text = '';
      const calls: ToolCall[] = [];
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          text += delta.content;
          onText(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const slot = (calls[tc.index] ??= { id: '', name: '', arguments: '' });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.arguments += tc.function.arguments;
        }
      }
      return { text, toolCalls: calls.filter(Boolean) };
    },
  };
}
