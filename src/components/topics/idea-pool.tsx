'use client';

import { useCallback, useEffect, useState } from 'react';

type Idea = { id: string; text: string; status: string };
const STATUS: Record<string, string> = { fresh: '没用过', used: '已出选题' };

/** 点子池: 随手写一句, 每晚生成选题时按先后排进去 */
export function IdeaPool() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const j = await fetch('/api/topics/ideas').then((r) => r.json()).catch(() => ({ success: false }));
    setIdeas(j.success && Array.isArray(j.data) ? j.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!text.trim()) return;
    setErr(null);
    const j = await fetch('/api/topics/ideas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    if (!j.success) return setErr(j.message);
    setText('');
    await load();
  };
  const remove = async (id: string) => {
    await fetch(`/api/topics/ideas/${id}`, { method: 'DELETE' }).catch(() => null);
    await load();
  };

  return (
    <section className="card space-y-3">
      <h2 className="text-[15px] font-semibold">点子池</h2>
      <input
        className="w-full rounded-[var(--r-md)] bg-[var(--bg-inset)] px-3 py-2 text-sm"
        placeholder="随手写一句点子，回车保存"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
        }}
      />
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
      {ideas.length > 0 && (
        <ul className="space-y-1 text-sm">
          {ideas.map((i) => (
            <li key={i.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">{i.text}</span>
              <span className="chip shrink-0 text-xs">{STATUS[i.status] ?? i.status}</span>
              <button className="shrink-0 text-xs text-[var(--danger)]" aria-label={`删除点子：${i.text}`} onClick={() => void remove(i.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
