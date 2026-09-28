'use client';

import { useState } from 'react';

export function DeepSeekKey({ initialMasked }: { initialMasked: string | null }) {
  const [masked, setMasked] = useState(initialMasked);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const call = async (method: 'PUT' | 'POST', body: object) => {
    const res = await fetch('/api/settings/deepseek', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.json();
  };
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <h3 className="mb-1 text-sm font-medium">DeepSeek key</h3>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">当前：{masked ?? '未配置'}。保存后写入项目目录的 .env，立即生效。</p>
      <div className="flex gap-2">
        <input type="password" autoComplete="off" className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} />
        <button
          className="rounded-md border border-[var(--border-strong)] px-3 text-sm"
          onClick={async () => {
            const j = await call('POST', key ? { key } : {});
            setMsg(j.success ? { ok: j.data.ok, text: j.data.message } : { ok: false, text: j.message });
          }}
        >
          测试连接
        </button>
        <button
          className="rounded-md bg-[var(--accent)] px-3 text-sm text-[var(--text-on-accent)]"
          onClick={async () => {
            const j = await call('PUT', { key });
            if (j.success) {
              setMasked(j.data.masked);
              setKey('');
              setMsg({ ok: true, text: '已保存。' });
            } else setMsg({ ok: false, text: j.message });
          }}
        >
          保存
        </button>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{msg.text}</p>}
    </section>
  );
}
