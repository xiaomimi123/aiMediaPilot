import type { Prisma, PrismaClient } from '@prisma/client';
import type { AgentMessage } from './chat-model';
import { buildSystemPrompt, loadHistory } from './context';

export interface ScopeMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string;
  toolInput?: Prisma.InputJsonValue;
  toolResult?: Prisma.InputJsonValue;
}

/** 一段对话在哪: 系统提示怎么来、历史从哪读、消息存到哪。项目编导与总助手各一种。 */
export interface ConversationScope {
  buildSystemPrompt(): Promise<string>;
  loadHistory(): Promise<AgentMessage[]>;
  save(m: ScopeMessage): Promise<void>;
}

export function projectScope(db: PrismaClient, projectId: string): ConversationScope {
  return {
    buildSystemPrompt: () => buildSystemPrompt(db, projectId),
    loadHistory: () => loadHistory(db, projectId),
    save: async (m) => {
      await db.chatMessage.create({ data: { projectId, ...m } });
    },
  };
}
