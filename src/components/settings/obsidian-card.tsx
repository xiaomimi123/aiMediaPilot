'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NotesSettingsView } from '@/app/api/settings/notes/route';

async function call(method: string, body?: unknown) {
  const res = await fetch('/api/settings/notes', { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

export function ObsidianCard() {
  const [v, setV] = useState<NotesSettingsView | null>(null);
  const [vault, setVault] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (j: { success: boolean; data?: NotesSettingsView; message?: string }, okText?: string) => {
    if (j.success && j.data) {
      setV(j.data);
      setVault(j.data.vault ?? '');
      if (okText) setMsg({ ok: true, text: okText });
    } else setMsg({ ok: false, text: j.message ?? '保存失败' });
  };
  const load = useCallback(async () => apply(await call('GET')), []);
  useEffect(() => {
    void load();
  }, [load]);

  // 保存中锁住勾选: 连点时不会拿旧列表覆盖上一次的修改
  const [saving, setSaving] = useState(false);
  const toggle = async (f: string) => {
    if (!v || saving) return;
    const readFolders = v.readFolders.includes(f) ? v.readFolders.filter((x) => x !== f) : [...v.readFolders, f];
    setSaving(true);
    try {
      apply(await call('PUT', { readFolders }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <h3 className="mb-1 text-[15px] font-semibold">Obsidian</h3>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">编导和助手只读勾选的文件夹；存进 Obsidian 只写 MediaPilot/，每次都要你在对话里确认。</p>
      {!v ? (
        <p className="text-sm text-[var(--text-secondary)]">读取中…</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-tertiary)]">库路径{v.detected ? '（自动识别）' : ''}</span>
            <input className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1" value={vault} onChange={(e) => setVault(e.target.value)} />
            <button className="btn-secondary" onClick={async () => apply(await call('PUT', { vault }), '已保存库路径。')}>
              保存
            </button>
          </div>
          <p className={`text-xs ${v.vaultProblem ? 'text-[var(--warning)]' : 'text-[var(--text-secondary)]'}`}>{v.vaultProblem ?? `可读 ${v.noteCount ?? 0} 篇笔记`}</p>
          <div className="flex flex-wrap gap-3">
            {v.topFolders.map((f) => (
              <label key={f} className="flex items-center gap-1 text-xs">
                <input type="checkbox" aria-label={f} disabled={saving} checked={v.readFolders.includes(f)} onChange={() => void toggle(f)} />
                {f}
              </label>
            ))}
          </div>
          {v.missing.map((f) => (
            <p key={f} className="text-xs text-[var(--danger)]">
              {f}：找不到（文件夹被删或改名了）
            </p>
          ))}
          <p className="text-xs text-[var(--text-tertiary)]">写入文件夹：{v.writeFolder}/（总是可读）</p>
        </div>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{msg.text}</p>}
    </section>
  );
}
