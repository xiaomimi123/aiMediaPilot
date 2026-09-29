import type OpenAI from 'openai';
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
  /** 显示名(报错时带上), 如 "DeepSeek（deepseek-chat）" */
  label?: string;
  streamTurn(messages: AgentMessage[], tools: ToolSpec[], onText: (delta: string) => void): Promise<ChatTurnResult>;
}

export function toToolSpec(tool: Tool<unknown>): ToolSpec {
  const { $schema: _drop, ...parameters } = zodToJsonSchema(tool.input, { $refStrategy: 'none' }) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, parameters };
}
