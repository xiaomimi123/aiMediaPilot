'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChatPanel } from '@/components/project/chat-panel';
import type { MessageView } from '@/lib/project/view';

type Thread = { id: string; title: string; updatedAt: string };
const QUICK = ['今天做什么', '找个选题开工', '最近数据怎么样'];

export function AssistantView() {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [current, setCurrent] = useState<{ id: string; messages: MessageView[] } | null>(null);

  const loadThreads = useCallback(async () => {
    const j = await (await fetch('/api/assistant/threads')).json().catch(() => ({ success: false }));
    const list: Thread[] = j.success ? j.data : [];
    setThreads(list);
    return list;
  }, []);
  const open = useCallback(async (id: string) => {
    const j = await (await fetch(`/api/assistant/threads/${id}`)).json().catch(() => ({ success: false }));
    if (j.success) setCurrent({ id, messages: j.data.messages });
  }, []);
  const create = useCallback(async () => {
    const j = await (await fetch('/api/assistant/threads', { method: 'POST' })).json().catch(() => ({ success: false }));
    if (j.success) {
      setCurrent({ id: j.data.id, messages: [] });
      await loadThreads();
    }
  }, [loadThreads]);

  useEffect(() => {
    void (async () => {
      const list = await loadThreads();
      if (list[0]) await open(list[0].id);
      else await create();
    })();
  }, [loadThreads, open, create]);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="shrink-0 border-b border-[var(--border-subtle)] p-3 md:w-56 md:border-b-0 md:border-r">
        <button className="mb-2 w-full rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--text-on-accent)]" onClick={() => void create()}>
          新对话
        </button>
        <select className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1 text-sm md:hidden" value={current?.id ?? ''} onChange={(e) => void open(e.target.value)}>
          {(threads ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
        <ul className="hidden space-y-1 md:block">
          {(threads ?? []).map((t) => (
            <li key={t.id}>
              <button className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${current?.id === t.id ? 'bg-[var(--bg-surface-hover)]' : 'hover:bg-[var(--bg-surface-hover)]'}`} onClick={() => void open(t.id)}>
                {t.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-h-0 min-w-0 flex-1">
        {current && (
          <ChatPanel
            key={current.id}
            projectId=""
            endpoint={`/api/assistant/threads/${current.id}/chat`}
            title="总助手"
            placeholder="问数据、让我开工、或者聊聊怎么调整…（Enter 发送）"
            emptyHint="可以问「今天有什么爆款」「帮我找个选题建项目写第一版」「最近数据不好怎么调整」。"
            busyText="助手在处理…"
            quickPrompts={QUICK}
            initialMessages={current.messages}
            onTurnStart={() => {}}
            onTurnEvent={() => {}}
            onTurnEnd={() => void loadThreads()}
          />
        )}
      </div>
    </div>
  );
}
