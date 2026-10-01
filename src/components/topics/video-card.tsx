'use client';

import { useState } from 'react';
import type { VideoView } from '@/lib/benchmark/view';
import { goTo } from './nav';

const n = (v: number) => v.toLocaleString('en-US');
const FIT: Record<string, string> = { high: '契合度高', mid: '契合度中', low: '契合度低' };
const FIT_COLOR: Record<string, string> = { high: 'text-[var(--success)]', mid: 'text-[var(--warning)]', low: 'text-[var(--text-tertiary)]' };

async function post(url: string, body?: unknown, method = 'POST') {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

export function VideoCard({ video: v, onChanged }: { video: VideoView; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = v.analysis;

  const act = async (fn: () => Promise<{ success: boolean; message?: string; data?: unknown }>, after?: (d: unknown) => void) => {
    setBusy(true);
    setErr(null);
    const j = await fn();
    setBusy(false);
    if (!j.success) return setErr(j.message ?? '操作失败');
    after?.(j.data);
    onChanged();
  };

  const toggle = () => {
    setOpen((o) => !o);
    if (!open && v.status === 'new') void post(`/api/topics/videos/${v.id}`, { status: 'seen' }, 'PATCH');
  };

  return (
    <article className="card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
        <span className="font-medium text-[var(--text-primary)]">{v.author}</span>
        <span>{new Date(v.publishedAt).toLocaleDateString('zh-CN')}</span>
        <span className="font-mono">{`${n(v.digg)} 赞${v.ratio ? ` · 平时的 ${v.ratio} 倍` : ''}`}</span>
        {v.status === 'adopted' && <span className="text-[var(--accent)]">已建项目</span>}
      </div>
      {a ? (
        <>
          <h3 className="mt-2 text-base font-semibold">{a.topic}</h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            <span className="text-[var(--text-tertiary)]">钩子（{a.hook.type}）：</span>
            {a.hook.quote}
          </p>
          <p className={`mt-1 text-xs ${FIT_COLOR[a.fit]}`}>
            <span>{FIT[a.fit]}</span>
            <span className="text-[var(--text-tertiary)]"> · {a.fitReason}</span>
          </p>
        </>
      ) : (
        <p className="mt-2 line-clamp-2 text-sm">{v.desc}</p>
      )}

      {v.analysisStatus === 'running' && <p className="mt-2 text-xs text-[var(--text-secondary)]">拆解中（下载、转写、分析，约 1 分钟）…</p>}
      {v.analysisStatus === 'failed' && (
        <p className="mt-2 text-xs text-[var(--danger)]">
          {v.analysisError}{' '}
          <button className="underline" disabled={busy} onClick={() => void act(() => post(`/api/topics/videos/${v.id}/analyze`))}>
            重试
          </button>
        </p>
      )}

      {open && a && (
        <div className="mt-3 space-y-2 border-t border-[var(--border-subtle)] pt-3 text-sm">
          <p><span className="text-[var(--text-tertiary)]">标题写法：</span>{a.titlePattern}</p>
          <p><span className="text-[var(--text-tertiary)]">你可以这么讲：</span>{a.myAngle}</p>
          <p className="text-[var(--text-tertiary)]">原文案：{v.desc}</p>
          {v.transcript && <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-[var(--bg-inset)] p-3 text-xs">{v.transcript}</pre>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        {a && <button className="text-[var(--accent)]" onClick={toggle}>{open ? '收起' : '看拆解'}</button>}
        {v.analysisStatus === 'none' && (
          <button className="text-[var(--accent)]" disabled={busy} onClick={() => void act(() => post(`/api/topics/videos/${v.id}/analyze`))}>
            拆解
          </button>
        )}
        <button
          className="text-[var(--accent)]"
          disabled={busy}
          onClick={() => void act(() => post(`/api/topics/videos/${v.id}/project`, {}), (d) => goTo(`/projects/${(d as { projectId: string }).projectId}`))}
        >
          建项目
        </button>
        <a className="text-[var(--text-secondary)]" href={v.url} target="_blank" rel="noreferrer">原视频</a>
        <button className="text-[var(--text-tertiary)]" disabled={busy} onClick={() => void act(() => post(`/api/topics/videos/${v.id}`, { status: 'ignored' }, 'PATCH'))}>
          忽略
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-[var(--danger)]">{err}</p>}
    </article>
  );
}
