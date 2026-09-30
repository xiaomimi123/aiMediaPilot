'use client';

import { useState } from 'react';
import type { TopicSuggestion } from '@/lib/benchmark/suggest';
import { goTo } from './nav';

export function SuggestPanel() {
  const [topics, setTopics] = useState<TopicSuggestion[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/topics/suggest', { method: 'POST' });
    const j = await res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
    setBusy(false);
    if (!j.success) return setMsg(j.message);
    setTopics(j.data);
  };
  const adopt = async (t: TopicSuggestion) => {
    const res = await fetch(`/api/topics/videos/${t.sources[0].id}/project`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: t.topic }) });
    const j = await res.json().catch(() => ({ success: false }));
    if (j.success) goTo(`/projects/${j.data.projectId}`);
    else setMsg(j.message ?? '建项目失败');
  };

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-center gap-3">
        <button className="shrink-0 whitespace-nowrap rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]" disabled={busy} onClick={() => void run()}>
          {busy ? '编导在挑…' : '让编导挑 3 个'}
        </button>
        <span className="text-xs text-[var(--text-tertiary)]">从近 14 天的对标爆款里，按你的定位挑</span>
      </div>
      {msg && <p className="mt-2 text-sm text-[var(--warning)]">{msg}</p>}
      {topics && (
        <ol className="mt-3 space-y-3">
          {topics.map((t, i) => (
            <li key={i} className="rounded-md bg-[var(--bg-inset)] p-3 text-sm">
              <div className="font-medium">{t.topic}</div>
              <p className="mt-1 text-[var(--text-secondary)]">{t.why}</p>
              <p className="mt-1 text-[var(--text-secondary)]"><span className="text-[var(--text-tertiary)]">开头可以这么说：</span>{t.hook}</p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">参考：{t.sources.map((s) => `${s.author}（平时的 ${s.ratio ?? '?'} 倍）`).join('、')}</p>
              <button className="mt-2 text-xs text-[var(--accent)]" onClick={() => void adopt(t)}>建项目</button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
