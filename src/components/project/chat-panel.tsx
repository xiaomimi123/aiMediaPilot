'use client';

import { useEffect, useRef, useState } from 'react';
import type { MessageView } from '@/lib/project/view';
import { parseSseBuffer } from '@/lib/agent/sse';
import type { AgentEvent } from '@/lib/agent/loop';
import { cn } from '@/lib/utils';

type Line = { key: string; role: MessageView['role']; content: string; ok: boolean | null };

export function ChatPanel({
  projectId,
  initialMessages,
  incoming = [],
  onTurnStart,
  onTurnEvent,
  onTurnEnd,
}: {
  projectId: string;
  initialMessages: MessageView[];
  incoming?: MessageView[];
  onTurnStart: () => void;
  onTurnEvent: (e: AgentEvent) => void;
  onTurnEnd: () => void;
}) {
  const [lines, setLines] = useState<Line[]>(() => initialMessages.map((m) => ({ key: m.id, role: m.role, content: m.content, ok: m.ok })));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // 任务通知(转写完成/失败)由工作区轮询送进来; 只追加没见过的
  const seen = useRef(new Set(initialMessages.map((m) => m.id)));
  useEffect(() => {
    const fresh = incoming.filter((m) => !seen.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach((m) => seen.current.add(m.id));
    setLines((ls) => [...ls, ...fresh.map((m) => ({ key: m.id, role: m.role, content: m.content, ok: m.ok }))]);
  }, [incoming]);
  const bottom = useRef<HTMLDivElement>(null);
  // 必须用块体: 新版 Chrome 的 scrollIntoView 返回 Promise, 箭头直返会被 React 当成清理函数调用
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    onTurnStart();
    const stamp = Date.now();
    let assistantKey = `a${stamp}`;
    setLines((ls) => [...ls, { key: `u${stamp}`, role: 'user', content: text, ok: null }]);

    const appendText = (delta: string) =>
      setLines((ls) => {
        const last = ls[ls.length - 1];
        if (last?.key === assistantKey) return [...ls.slice(0, -1), { ...last, content: last.content + delta }];
        return [...ls, { key: assistantKey, role: 'assistant', content: delta, ok: null }];
      });

    try {
      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ message: `请求失败（${res.status}）` }));
        setLines((ls) => [...ls, { key: `e${stamp}`, role: 'system', content: j.message, ok: false }]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSseBuffer(buffer);
        buffer = rest;
        for (const e of events) {
          onTurnEvent(e);
          if (e.type === 'text') appendText(e.delta);
          if (e.type === 'tool') {
            setLines((ls) => [...ls, { key: `t${Date.now()}${Math.random()}`, role: 'tool', content: e.summary, ok: e.ok }]);
            assistantKey = `a${Date.now()}${Math.random()}`; // 工具之后的文字另起一条
          }
          if (e.type === 'error') setLines((ls) => [...ls, { key: `e${Date.now()}`, role: 'system', content: e.message, ok: false }]);
        }
      }
    } catch (e) {
      setLines((ls) => [...ls, { key: `e${stamp}`, role: 'system', content: `连接中断：${e instanceof Error ? e.message : String(e)}。刷新页面后再发一次。`, ok: false }]);
    } finally {
      setBusy(false);
      onTurnEnd();
    }
  }

  return (
    <div className="flex h-full flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-medium">编导对话</div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4 text-sm">
        {lines.length === 0 && (
          <p className="text-[var(--text-tertiary)]">说说这条想讲什么，比如：「让 AI 当反方挑刺，帮你检查方案漏洞，60 秒」。</p>
        )}
        {lines.map((l) =>
          l.role === 'tool' ? (
            <div key={l.key} className={cn('border-l-2 pl-2 text-xs', l.ok ? 'border-[var(--accent)] text-[var(--text-secondary)]' : 'border-[var(--danger)] text-[var(--danger)]')}>
              {l.ok ? '✓' : '✗'} {l.content}
            </div>
          ) : (
            <div
              key={l.key}
              className={cn(
                'whitespace-pre-wrap rounded-lg px-3 py-2',
                l.role === 'user' && 'ml-8 bg-[var(--accent-subtle)]',
                l.role === 'assistant' && 'mr-8 bg-[var(--bg-surface)]',
                l.role === 'system' && l.ok === true && 'border border-[var(--border-subtle)] bg-[var(--info-subtle)] text-[var(--info)]',
                l.role === 'system' && l.ok !== true && 'bg-[var(--danger-subtle)] text-[var(--danger)]',
              )}
            >
              {l.content}
            </div>
          ),
        )}
        {busy && <div className="text-xs text-[var(--text-tertiary)]">编导在想…</div>}
        <div ref={bottom} />
      </div>
      <div className="border-t border-[var(--border-subtle)] p-3">
        <textarea
          className="h-20 w-full resize-none rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] p-2 text-sm"
          placeholder="和编导说点什么…（Enter 发送，Shift+Enter 换行）"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
      </div>
    </div>
  );
}
