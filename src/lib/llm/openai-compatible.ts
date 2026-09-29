import OpenAI from 'openai';
import type { ChatModel, ToolCall } from '@/lib/agent/chat-model';
import type { StructuredLLM } from '@/lib/script/write';
import { OpenAIVisionLLM } from './vision';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

/** 本地 Ollama 等不需要 key, 但 openai 库要求非空: 传占位 */
const keyOrPlaceholder = (k: string) => k || 'none';

export function createOpenAICompatibleChat(c: OpenAICompatibleConfig): ChatModel {
  const client = new OpenAI({ apiKey: keyOrPlaceholder(c.apiKey), baseURL: c.baseUrl });
  return {
    label: c.label,
    async streamTurn(messages, tools, onText) {
      const stream = await client.chat.completions.create({
        model: c.model,
        messages,
        stream: true,
        // 空数组会被部分厂商拒绝, 没有工具时不传
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

export function createOpenAICompatibleLLM(c: OpenAICompatibleConfig): StructuredLLM {
  return new OpenAIVisionLLM({ apiKey: keyOrPlaceholder(c.apiKey), baseURL: c.baseUrl, jsonModeFallback: true, defaultModel: c.model });
}
