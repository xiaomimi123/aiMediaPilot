'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FilmSessionData } from '@/app/api/projects/[id]/film-session/route';
import { cn } from '@/lib/utils';

const sec = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function FilmAssistant({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [d, setD] = useState<FilmSessionData | null>(null);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [base, setBase] = useState<number | null>(null);
  const [orient, setOrient] = useState<'portrait' | 'landscape'>('portrait');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const url = `/api/projects/${projectId}/film-session`;

  const load = useCallback(async () => {
    const j = await fetch(url).then((r) => r.json()).catch(() => ({ success: false, message: '读取出片状态失败' }));
    if (j.success) setD(j.data);
    else setErr(j.message);
  }, [url]);
  useEffect(() => {
    void load();
  }, [load]);
  // 在跑时每 3 秒刷新; 状态变化时通知工作区(拿对话里的通知、成片列表)
  const status = d?.current?.status;
  useEffect(() => {
    if (status !== 'running') return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [status, load]);
  const [prevStatus, setPrevStatus] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (prevStatus === 'running' && status !== 'running') onChanged();
    setPrevStatus(status);
  }, [status, prevStatus, onChanged]);

  const post = async (body: object) => {
    setBusy(true);
    setErr(null);
    const j = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    setBusy(false);
    if (j.success) {
      setD(j.data);
      setReply('');
      setNote('');
    } else setErr(j.message);
  };

  if (!d) return <div className="card text-sm text-[var(--text-secondary)]">{err ?? '读取出片状态…'}</div>;
  const c = d.current;
  const blocked = !d.claudeAvailable ? '本机没有可用的 Claude Code：安装后在终端运行 claude 登录' : d.busyElsewhere ? `「${d.busyElsewhere.title}」正在出片` : null;
  const latest = d.versions[0] ?? null;
  const baseVersion = base ?? latest;
  const fileUrl = (p: string) => `/api/film-sessions/${c!.id}/file?path=${encodeURIComponent(p)}`;

  return (
    <section className="card space-y-3 text-sm">
      <h3 className="text-[15px] font-semibold">出片助手</h3>
      {err && <p className="text-[var(--danger)]">{err}</p>}

      {!c ? (
        <div className="space-y-3">
          {blocked && <p className="text-[var(--warning)]">{blocked}</p>}
          <div className="space-y-2">
            <textarea className="h-16 w-full rounded-[var(--r-md)] bg-[var(--bg-inset)] p-2" placeholder="要求（可不填），比如：开头用截图那张素材，节奏快一点" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-[var(--r-md)] bg-[var(--bg-inset)] p-0.5 text-xs" role="group" aria-label="版式">
                {(['portrait', 'landscape'] as const).map((o) => (
                  <button key={o} aria-pressed={orient === o} className={cn('rounded-[var(--r-sm)] px-2 py-1', orient === o && 'bg-[var(--bg-surface)] font-semibold shadow-sm')} onClick={() => setOrient(o)}>
                    {o === 'landscape' ? '横版' : '竖版'}
                  </button>
                ))}
              </div>
              <button className="btn-primary" disabled={busy || !!blocked} onClick={() => void post({ action: 'start', kind: 'new', ...(orient === 'landscape' ? { orientation: 'landscape' } : {}), ...(note.trim() ? { note: note.trim() } : {}) })}>
                出一版
              </button>
              {latest !== null && (
                <>
                  <select className="rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1" value={baseVersion ?? ''} onChange={(e) => setBase(Number(e.target.value))}>
                    {d.versions.map((v) => (
                      <option key={v} value={v}>{`基于 v${v}（${d.orientations?.[v] === 'landscape' ? '横版' : '竖版'}）`}</option>
                    ))}
                  </select>
                  <input className="min-w-0 flex-1 rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1.5" placeholder="修改意见，比如：第 3 镜太挤，换成对比卡" value={reply} onChange={(e) => setReply(e.target.value)} />
                  <button className="btn-secondary" disabled={busy || !!blocked || !reply.trim()} onClick={() => void post({ action: 'start', kind: 'revise', baseVersion, note: reply.trim() })}>
                    改这一版
                  </button>
                  <span className="w-full text-xs text-[var(--text-tertiary)]">改片沿用原版本的版式</span>
                </>
              )}
            </div>
          </div>
          {d.history.length > 0 && (
            <ul className="space-y-1 text-xs text-[var(--text-tertiary)]">
              {d.history.map((h) => (
                <li key={h.id}>{`${h.status === 'done' ? `v${h.version}` : '已放弃'} · ${new Date(h.createdAt).toLocaleDateString('zh-CN')}${h.summary ? ` · ${h.summary}` : ''}`}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <ol className="space-y-1.5">
            {c.items.map((it, i) =>
              it.kind === 'you' ? (
                <li key={i} className="ml-8 rounded-[var(--r-md)] bg-[var(--accent-subtle)] px-3 py-1.5">{it.text}</li>
              ) : it.kind === 'say' ? (
                <li key={i} className="mr-8 whitespace-pre-wrap rounded-[var(--r-md)] bg-[var(--bg-inset)] px-3 py-1.5">{it.text}</li>
              ) : it.kind === 'denied' ? (
                <li key={i} className="text-xs text-[var(--warning)]">{`⛔ 被拒绝：${it.text}`}</li>
              ) : it.kind === 'still' ? (
                <li key={i} className="inline-block pr-2">
                  <button onClick={() => setZoom(it.path)}>
                    <img src={fileUrl(it.path)} alt={it.path} className="h-24 rounded-[var(--r-sm)]" />
                  </button>
                </li>
              ) : (
                <li key={i} className={cn('text-xs', it.ok === false ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]')}>{`${it.ok === false ? '✗' : '✓'} ${it.text}`}</li>
              ),
            )}
            {c.status === 'running' && <li className="text-xs text-[var(--text-tertiary)]">⏳ 正在做…</li>}
          </ol>

          {c.status === 'running' && (
            <button className="btn-secondary" disabled={busy} onClick={() => void post({ action: 'stop' })}>
              停止
            </button>
          )}

          {c.status === 'waiting' && (
            <div className="card-hero space-y-2">
              <div className="font-semibold">{c.checkpoint === 'shots' ? '等你确认镜头表' : c.checkpoint === 'render' ? '等你确认成片' : '它在等你回答'}</div>
              {c.checkpoint === 'shots' && c.shots && (
                <table className="w-full text-xs tabular-nums">
                  <tbody>
                    {c.shots.map((s) => (
                      <tr key={s.id} className="border-t border-[var(--border-subtle)]">
                        <td className="py-1 pr-2">{`${sec(s.fromSec)}–${sec(s.toSec)}`}</td>
                        <td className="py-1 pr-2">{s.intent}</td>
                        <td className="py-1 text-[var(--text-tertiary)]">{s.material ? `素材 ${s.material}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {c.checkpoint === 'render' && c.previewUrl && <video src={c.previewUrl} controls className="max-h-[60vh] w-full rounded-[var(--r-md)] bg-black" />}
              <div className="flex flex-wrap gap-2">
                {c.checkpoint === 'shots' && (
                  <button className="btn-primary" disabled={busy} onClick={() => void post({ action: 'reply', text: '可以，继续' })}>可以，继续</button>
                )}
                {c.checkpoint === 'render' && (
                  <button className="btn-primary" disabled={busy} onClick={() => void post({ action: 'register' })}>登记为新版本</button>
                )}
                <input className="min-w-0 flex-1 rounded-[var(--r-md)] bg-[var(--bg-surface)] px-2 py-1.5" placeholder="或者写你的意见…" value={reply} onChange={(e) => setReply(e.target.value)} />
                <button className="btn-secondary" disabled={busy || !reply.trim()} onClick={() => void post({ action: 'reply', text: reply.trim() })}>发送</button>
              </div>
            </div>
          )}

          {(c.status === 'failed' || c.status === 'stopped') && (
            <div className="space-y-2">
              <p className="text-[var(--danger)]">{`出片停了：${c.message ?? '出错了'}`}</p>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={busy || !!blocked} onClick={() => void post({ action: 'reply', text: '接着做' })}>接着做</button>
                {c.filmDir && (
                  <button className="btn-secondary" disabled={busy || !!blocked} title="旧对话太长被拒收时用：开新对话，从检查开始接着做同一个片子" onClick={() => void post({ action: 'restart' })}>
                    换个新对话接着做
                  </button>
                )}
                <button className="btn-secondary" disabled={busy} onClick={() => void post({ action: 'abandon' })}>放弃</button>
              </div>
              <div className="flex gap-2">
                <input className="min-w-0 flex-1 rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1.5" placeholder="或者写你的意见，再接着做…" value={reply} onChange={(e) => setReply(e.target.value)} />
                <button className="btn-secondary" disabled={busy || !!blocked || !reply.trim()} onClick={() => void post({ action: 'reply', text: reply.trim() })}>发送</button>
              </div>
            </div>
          )}
        </div>
      )}

      {zoom && c && (
        <button className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setZoom(null)}>
          <img src={fileUrl(zoom)} alt={zoom} className="max-h-[90vh] rounded-[var(--r-md)]" />
        </button>
      )}
    </section>
  );
}
