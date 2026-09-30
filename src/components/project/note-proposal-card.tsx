'use client';

import { useEffect, useState } from 'react';
import type { ProposalView } from '@/lib/notes/proposals';

const DONE: Record<string, string> = { written: '已存进 Obsidian', rejected: '已不要', expired: '已过期' };

export function NoteProposalCard({ proposalId }: { proposalId: string }) {
  const [p, setP] = useState<ProposalView | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/notes/proposals/${proposalId}`)
      .then((r) => r.json())
      .then((j) => (j.success ? setP(j.data) : setErr(j.message)))
      .catch(() => setErr('读取提议失败'));
  }, [proposalId]);

  const decide = async (action: 'accept' | 'reject') => {
    setBusy(true);
    const j = await fetch(`/api/notes/proposals/${proposalId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    setBusy(false);
    if (j.success) setP(j.data);
    else setErr(j.message);
  };

  if (!p) return <div className="text-xs text-[var(--text-tertiary)]">{err ?? '读取提议…'}</div>;
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs">
      <div className="font-medium">要把这个项目存进 Obsidian 吗？</div>
      <div className="mt-1 text-[var(--text-tertiary)]">{p.path}</div>
      <button type="button" className="mt-1 underline" onClick={() => setOpen((o) => !o)}>
        {open ? '收起' : '预览'}
      </button>
      {open && <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-[var(--text-secondary)]">{p.content}</pre>}
      {(p.error || err) && <p className="mt-2 text-[var(--danger)]">{p.error ?? err}</p>}
      {p.status === 'pending' ? (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} className="rounded-md bg-[var(--accent)] px-3 py-1 text-[var(--text-on-accent)] disabled:opacity-50" onClick={() => void decide('accept')}>
            存进 Obsidian
          </button>
          <button type="button" disabled={busy} className="rounded-md border border-[var(--border-strong)] px-3 py-1" onClick={() => void decide('reject')}>
            不要
          </button>
        </div>
      ) : (
        <div className="mt-2 text-[var(--text-secondary)]">{DONE[p.status] ?? p.status}</div>
      )}
    </div>
  );
}
