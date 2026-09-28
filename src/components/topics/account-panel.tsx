'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AccountView } from '@/lib/benchmark/view';

const n = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v));

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

function Row({ a, action }: { a: AccountView; action: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      {a.avatarUrl ? <img src={a.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full" referrerPolicy="no-referrer" /> : <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--bg-inset)]" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{a.nickname}</div>
        <div className="truncate text-xs text-[var(--text-tertiary)]">
          {a.followers ? `${n(a.followers)} 粉丝` : '资料待首次巡检'}
          {a.status === 'candidate' && a.bio ? ` · ${a.bio.slice(0, 30)}` : ''}
          {a.baselineDigg ? ` · 平时约 ${n(a.baselineDigg)} 赞` : ''}
          {a.lastHitAt ? ` · 最近爆款 ${new Date(a.lastHitAt).toLocaleDateString('zh-CN')}` : ''}
          {a.lastCheckedAt ? ` · 上次巡检 ${new Date(a.lastCheckedAt).toLocaleDateString('zh-CN')}` : ''}
        </div>
      </div>
      {action}
    </li>
  );
}

export function AccountPanel({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<{ following: AccountView[]; candidates: AccountView[] } | null>(null);
  const [kw, setKw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const j = await call('/api/topics/accounts', 'GET');
    if (j.success) setData(j.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (id: string, status: string) => {
    const j = await call(`/api/topics/accounts/${id}`, 'PATCH', { status });
    if (!j.success) setMsg(j.message);
    await load();
    onChanged();
  };
  const search = async () => {
    setBusy(true);
    setMsg(null);
    const j = await call('/api/topics/accounts/search', 'POST', { keyword: kw });
    setBusy(false);
    if (!j.success) return setMsg(j.message);
    setMsg(j.data.length ? null : '没搜到博主，换个词试试。');
    await load();
  };

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <h2 className="mb-2 text-sm font-medium">对标账号（关注中 {data?.following.length ?? 0} 个，每晚 20:30 巡检）</h2>
      <ul className="divide-y divide-[var(--border-subtle)]">
        {data?.following.map((a) => (
          <Row key={a.id} a={a} action={<button className="shrink-0 text-xs text-[var(--text-tertiary)]" onClick={() => void setStatus(a.id, 'candidate')}>取消关注</button>} />
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <input className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm" placeholder="按关键词搜博主，如：AI工具" value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} />
        <button className="shrink-0 rounded-md border border-[var(--border-strong)] px-3 text-sm" disabled={busy || !kw.trim()} onClick={() => void search()}>
          {busy ? '搜索中…' : '搜索'}
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--text-tertiary)]">用你的大号只读搜索，每天最多 10 次。也可以在上方粘贴博主主页链接直接关注。</p>
      {msg && <p className="mt-2 text-xs text-[var(--danger)]">{msg}</p>}
      {data && data.candidates.length > 0 && (
        <>
          <h3 className="mt-4 text-xs text-[var(--text-secondary)]">候选（点关注才会加入巡检）</h3>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {data.candidates.map((a) => (
              <Row
                key={a.id}
                a={a}
                action={
                  <span className="flex shrink-0 gap-3 text-xs">
                    <button className="text-[var(--accent)]" onClick={() => void setStatus(a.id, 'following')}>关注</button>
                    <button className="text-[var(--text-tertiary)]" onClick={() => void setStatus(a.id, 'ignored')}>不要</button>
                  </span>
                }
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
