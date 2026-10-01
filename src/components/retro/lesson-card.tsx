'use client';

import { useState } from 'react';
import type { LessonView } from '@/lib/retro/view';

async function patch(id: string, body: object) {
  const res = await fetch(`/api/lessons/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

export function LessonCard({ lesson: l, onChanged }: { lesson: LessonView; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(l.text);
  const [err, setErr] = useState<string | null>(null);
  const act = async (body: object) => {
    const j = await patch(l.id, body);
    if (!j.success) return setErr(j.message);
    setEditing(false);
    onChanged();
  };
  return (
    <div className="rounded-[var(--r-md)] bg-[var(--bg-inset)] p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-tertiary)]">
        <span>{l.stageLabel}</span>
        <span>{l.evidenceCount <= 1 ? `证据少：${l.evidenceCount} 条作品` : `${l.evidenceCount} 条作品`}</span>
        {l.status === 'active' && <span className="text-[var(--success)]">生效中</span>}
        {l.status === 'retired' && <span>已停用</span>}
      </div>
      {editing ? (
        <input className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1" value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <p className="mt-1">{l.text}</p>
      )}
      {l.contradicted && l.status === 'active' && <p className="mt-1 text-xs text-[var(--warning)]">最近一次复盘没应验，要不要停用？</p>}
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {l.status === 'candidate' && !editing && (
          <>
            <button className="text-[var(--accent)]" onClick={() => void act({ status: 'active' })}>采纳</button>
            <button className="text-[var(--accent)]" onClick={() => setEditing(true)}>改一下再采纳</button>
            <button className="text-[var(--text-tertiary)]" onClick={() => void act({ status: 'rejected' })}>不要</button>
          </>
        )}
        {editing && <button className="text-[var(--accent)]" onClick={() => void act({ text, status: 'active' })}>保存并采纳</button>}
        {l.status === 'active' && <button className="text-[var(--text-tertiary)]" onClick={() => void act({ status: 'retired' })}>停用</button>}
        {l.status === 'retired' && <button className="text-[var(--accent)]" onClick={() => void act({ status: 'active' })}>重新启用</button>}
      </div>
      {err && <p className="mt-1 text-xs text-[var(--danger)]">{err}</p>}
    </div>
  );
}
