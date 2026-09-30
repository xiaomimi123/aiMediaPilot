'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MessageView } from '@/lib/project/view';
import { parseSseBuffer } from '@/lib/agent/sse';
import type { AgentEvent } from '@/lib/agent/loop';
import { cn } from '@/lib/utils';
import { NoteProposalCard } from './note-proposal-card';

type Line = { key: string; role: MessageView['role']; content: string; ok: boolean | null; detail: string | null; open?: boolean; proposalId?: string | null };

const toLine = (m: MessageView): Line => ({ key: m.id, role: m.role, content: m.content, ok: m.ok, detail: m.detail ?? null, proposalId: m.proposalId ?? null });

/** 回复里的 /projects/<id> 与 /topics 渲染成可点链接 */
export function linkify(text: string): (string | { href: string; label: string })[] {
  const out: (string | { href: string; label: string })[] = [];
  const re = /\/projects\/[a-z0-9]+|\/topics\b/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push({ href: m[0], label: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Linked({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((p, i) =>
        typeof p === 'string' ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <Link key={i} href={p.href} className="text-[var(--accent)] underline">
            {p.label}
          </Link>
        ),
      )}
    </>
  );
}

export function ChatPanel({
  projectId,
  initialMessages,
  incoming = [],
  onTurnStart,
  onTurnEvent,
  onTurnEnd,
  endpoint,
  title = '编导对话',
  placeholder = '和编导说点什么…（Enter 发送，Shift+Enter 换行）',
  emptyHint = '说说这条想讲什么，比如：「让 AI 当反方挑刺，帮你检查方案漏洞，60 秒」。',
  busyText = '编导在想…',
  quickPrompts = [],
  pendingSend = null,
}: {
  projectId: string;
  initialMessages: MessageView[];
  incoming?: MessageView[];
  onTurnStart: () => void;
  onTurnEvent: (e: AgentEvent) => void;
  onTurnEnd: () => void;
  /** 默认是项目编导的对话接口 */
  endpoint?: string;
  title?: string;
  placeholder?: string;
  emptyHint?: string;
  busyText?: string;
  quickPrompts?: string[];
  /** 外部交来的消息(如预测面板的改稿建议), id 变化时发出 */
  pendingSend?: { id: string; text: string } | null;
}) {
  const [lines, setLines] = useState<Line[]>(() => initialMessages.map(toLine));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // 任务通知(转写完成/失败)由工作区轮询送进来; 只追加没见过的
  const seen = useRef(new Set(initialMessages.map((m) => m.id)));
  useEffect(() => {
    const fresh = incoming.filter((m) => !seen.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach((m) => seen.current.add(m.id));
    setLines((ls) => [...ls, ...fresh.map(toLine)]);
  }, [incoming]);
  const bottom = useRef<HTMLDivElement>(null);
  // 必须用块体: 新版 Chrome 的 scrollIntoView 返回 Promise, 箭头直返会被 React 当成清理函数调用
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  const sentIds = useRef(new Set<string>());
  useEffect(() => {
    if (!pendingSend || sentIds.current.has(pendingSend.id)) return;
    sentIds.current.add(pendingSend.id);
    void send(pendingSend.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSend?.id]);

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    onTurnStart();
    const stamp = Date.now();
    let assistantKey = `a${stamp}`;
    setLines((ls) => [...ls, { key: `u${stamp}`, role: 'user', content: text, ok: null, detail: null }]);

    const appendText = (delta: string) =>
      setLines((ls) => {
        const last = ls[ls.length - 1];
        if (last?.key === assistantKey) return [...ls.slice(0, -1), { ...last, content: last.content + delta }];
        return [...ls, { key: assistantKey, role: 'assistant', content: delta, ok: null, detail: null }];
      });

    try {
      const res = await fetch(endpoint ?? `/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ message: `请求失败（${res.status}）` }));
        setLines((ls) => [...ls, { key: `e${stamp}`, role: 'system', content: j.message, ok: false, detail: null }]);
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
            setLines((ls) => [...ls, { key: `t${Date.now()}${Math.random()}`, role: 'tool', content: e.summary, ok: e.ok, detail: e.detail ?? null }]);
            assistantKey = `a${Date.now()}${Math.random()}`; // 工具之后的文字另起一条
          }
          if (e.type === 'error') setLines((ls) => [...ls, { key: `e${Date.now()}`, role: 'system', content: e.message, ok: false, detail: null }]);
        }
      }
    } catch (e) {
      setLines((ls) => [...ls, { key: `e${stamp}`, role: 'system', content: `连接中断：${e instanceof Error ? e.message : String(e)}。刷新页面后再发一次。`, ok: false, detail: null }]);
    } finally {
      setBusy(false);
      onTurnEnd();
    }
  }

  return (
    <div className="flex h-full flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-medium">{title}</div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4 text-sm">
        {lines.length === 0 && (
          <p className="text-[var(--text-tertiary)]">{emptyHint}</p>
        )}
        {lines.map((l) =>
          l.proposalId ? (
            <NoteProposalCard key={l.key} proposalId={l.proposalId} />
          ) : l.role === 'tool' ? (
            <div key={l.key} className={cn('border-l-2 pl-2 text-xs', l.ok ? 'border-[var(--accent)] text-[var(--text-secondary)]' : 'border-[var(--danger)] text-[var(--danger)]')}>
              <div
                className={cn(l.detail && 'cursor-pointer')}
                onClick={() => l.detail && setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, open: !x.open } : x)))}
              >
                {l.ok ? '✓' : '✗'} <Linked text={l.content} />
                {l.detail && <span className="ml-1 text-[var(--text-tertiary)]">{l.open ? '▾' : '▸'}</span>}
              </div>
              {l.open && l.detail && <pre className="mt-1 whitespace-pre-wrap font-sans text-[var(--text-tertiary)]"><Linked text={l.detail} /></pre>}
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
              <Linked text={l.content} />
              {l.role === 'system' && l.ok !== true && l.content.includes('设置页') && (
                <Link href="/settings" className="ml-2 underline">
                  打开设置页
                </Link>
              )}
            </div>
          ),
        )}
        {busy && <div className="text-xs text-[var(--text-tertiary)]">{busyText}</div>}
        <div ref={bottom} />
      </div>
      <div className="border-t border-[var(--border-subtle)] p-3">
        <textarea
          className="h-20 w-full resize-none rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] p-2 text-sm"
          placeholder={placeholder}
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
        {quickPrompts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {quickPrompts.map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                className="rounded-full border border-[var(--border-default)] px-3 py-1 text-xs hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
                onClick={() => void send(q)}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
