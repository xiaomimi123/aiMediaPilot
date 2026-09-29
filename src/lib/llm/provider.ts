import type { PrismaClient } from '@prisma/client';
import type { ChatModel } from '@/lib/agent/chat-model';
import type { StructuredLLM } from '@/lib/script/write';
import { ensureMigrated, getActiveConfig, type ModelConfig } from './providers';
import { createOpenAICompatibleChat, createOpenAICompatibleLLM } from './openai-compatible';

export const NO_MODEL_MESSAGE = '还没有可用的模型：去设置页添加一个。';

export interface ActiveModel {
  chat: ChatModel;
  llm: StructuredLLM;
  label: string;
  config: ModelConfig;
}

export function buildModel(c: ModelConfig): ActiveModel {
  const label = `${c.name}（${c.model}）`;
  const base = { baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, label };
  if (c.kind === 'anthropic') throw new Error('Claude 适配还没做');
  return { chat: createOpenAICompatibleChat(base), llm: createOpenAICompatibleLLM(base), label, config: c };
}

/** 当前模型; 没有返回 null(调用方给 NO_MODEL_MESSAGE)。首次会从 .env 迁移 DeepSeek。 */
export async function getActiveModel(db: PrismaClient, env: { DEEPSEEK_API_KEY?: string } = { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY }): Promise<ActiveModel | null> {
  await ensureMigrated(db, env);
  const c = await getActiveConfig(db);
  return c ? buildModel(c) : null;
}
