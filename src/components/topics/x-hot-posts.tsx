'use client';

import { useCallback, useEffect, useState } from 'react';

type XItem = { id: string; title: string; summary: string | null; url: string; heat: number; day: string };

/** 选题页「X 热帖」: 近 3 天抓到的 X 原创热帖(按浏览排), 看到好的转进灵感池 */
export function XHotPosts() {
  const [items, setItems] = useState<XItem[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch('/api/sources/x').then((r) => r.json()).catch(() => ({ success: false }));
    setItems(j.success && Array.isArray(j.data) ? j.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toIdea = async (item: XItem) => {
    setErr(null);
    const text = `${item.title}（X 热帖，${item.heat.toLocaleString('en-US')} 浏览）${item.summary && item.summary !== item.title ? `\n原文：${item.summary}` : ''}`;
    const j = await fetch('/api/topics/ideas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
      .then((r) => r.json())
      .catch(() => ({ success: false }));
    if (!j.success) return setErr(j.message ?? '转灵感失败');
    setSaved(item.id);
  };

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold">X 热帖</h2>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">近 3 天抓到的 X（推特）原创热帖，按浏览数排（只留原创、滤掉回复）。看到能改写仿写的转进灵感池；每晚选题也会自动轮到这些当资讯素材。</p>
      </div>
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
      {!items ? (
        <p className="text-sm text-[var(--text-tertiary)]">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)]">近 3 天还没有 X 热帖入库。每天 19:00 自动抓，或在终端跑 npm run fetch:sources。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id} className="rounded-[var(--r-md)] bg-[var(--bg-inset)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <a className="min-w-0 flex-1 text-sm underline-offset-2 hover:underline" href={it.url} target="_blank" rel="noreferrer">
                  {it.title}
                </a>
                <span className="shrink-0 chip text-xs">{`${it.heat.toLocaleString('en-US')} 浏览`}</span>
                <button className="btn-secondary shrink-0 px-3 py-1 text-xs" onClick={() => void toIdea(it)}>
                  {saved === it.id ? '已转灵感' : '转灵感'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
