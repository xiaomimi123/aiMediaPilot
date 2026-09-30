import { describe, expect, it } from 'vitest';
import { runAgentTurn, type AgentEvent } from '@/lib/agent/loop';
import type { ConversationScope, ScopeMessage } from '@/lib/agent/scope';
import type { ChatModel } from '@/lib/agent/chat-model';

describe('runAgentTurn with a custom scope', () => {
  it('uses the scope for prompt, history and saving', async () => {
    const saved: ScopeMessage[] = [];
    const seen: unknown[] = [];
    const scope: ConversationScope = {
      buildSystemPrompt: async () => '你是总助手',
      loadHistory: async () => [{ role: 'user', content: '之前的话' }],
      save: async (m) => void saved.push(m),
    };
    const model: ChatModel = {
      async streamTurn(messages, _t, onText) {
        seen.push(...messages);
        onText('好的');
        return { text: '好的', toolCalls: [] };
      },
    };
    const events: AgentEvent[] = [];
    await runAgentTurn({ scope, userText: '你好', db: {} as never, model, tools: [], toolCtx: { projectId: '', db: {} as never, llm: {} as never }, emit: (e) => events.push(e) });
    expect(seen[0]).toEqual({ role: 'system', content: '你是总助手' });
    expect(saved.map((m) => [m.role, m.content])).toEqual([['user', '你好'], ['assistant', '好的']]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });
});
