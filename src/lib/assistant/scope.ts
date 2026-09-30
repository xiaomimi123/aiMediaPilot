import type { PrismaClient } from '@prisma/client';
import type { ConversationScope } from '@/lib/agent/scope';
import type { AgentMessage } from '@/lib/agent/chat-model';
import { HISTORY_LIMIT } from '@/lib/agent/context';
import { buildAssistantPrompt } from './context';

export const THREAD_TITLE_LEN = 30;

export function assistantScope(db: PrismaClient, threadId: string, now = new Date()): ConversationScope {
  return {
    buildSystemPrompt: () => buildAssistantPrompt(db, now),
    async loadHistory(): Promise<AgentMessage[]> {
      const rows = await db.assistantMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT });
      return rows.reverse().flatMap((m): AgentMessage[] => {
        if (m.role === 'user') return [{ role: 'user', content: m.content }];
        if (m.role === 'assistant') return m.content ? [{ role: 'assistant', content: m.content }] : [];
        if (m.role === 'tool') return [{ role: 'assistant', content: `（已执行 ${m.toolName}：${m.content}）` }];
        return [];
      });
    },
    async save(m) {
      await db.assistantMessage.create({ data: { threadId, ...m } });
      const t = await db.assistantThread.findUnique({ where: { id: threadId } });
      // 标题取第一句用户消息, 只设一次
      const title = m.role === 'user' && t?.title === '新对话' ? m.content.replace(/\s+/g, ' ').trim().slice(0, THREAD_TITLE_LEN) : undefined;
      await db.assistantThread.update({ where: { id: threadId }, data: { ...(title ? { title } : {}), updatedAt: new Date() } });
    },
  };
}
