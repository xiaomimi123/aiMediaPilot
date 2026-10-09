'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { dailyReason, type DailyCard } from '@/lib/topics/daily';
import { fmtViews } from '@/lib/predict/formula';
import { ROLE_LABEL } from '@/lib/script/model';

type Data = { topics: DailyCard[]; lastRun: { day: string; created: number; reasons: string[] } | null };

export function DailyTopics() {
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState<string | null>(null);
  // 正在填的实测结果(按选题 id)
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const j = await fetch('/api/topics/daily').then((r) => r.json()).catch(() => ({ success: false }));
    setD(j.success ? j.data : { topics: [], lastRun: null });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const rewrite = async (t: DailyCard) => {
    setBusy(t.id);
    setErr(null);
    const results = t.checklist.map((_, i) => (draft[t.id] ?? t.results)[i] ?? '');
    const j = await fetch(`/api/topics/daily/${t.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'rewrite', results }) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    setBusy(null);
    if (!j.success) return setErr(j.message);
    setOpen(t.id);
    await load();
  };

  const act = async (id: string, action: 'adopt' | 'dismiss') => {
    setBusy(id);
    setErr(null);
    const j = await fetch(`/api/topics/daily/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    setBusy(null);
    if (!j.success) return setErr(j.message);
    if (action === 'adopt') router.push(`/projects/${j.data.projectId}`);
    else await load();
  };

  if (!d) return null;
  return (
    <section id="daily" className="card space-y-3">
      <h2 className="text-[15px] font-semibold">今日选题</h2>
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
      {d.topics.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">{dailyReason(d.lastRun) ?? '今晚 23:00 会自动生成；也可以在「设置 · 每晚任务」立即运行'}</p>
      ) : (
        <ul className="space-y-3">
          {d.topics.map((t) => (
            <li key={t.id} className="rounded-[var(--r-md)] bg-[var(--bg-inset)] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip">{t.sourceLabel}</span>
                <b className="text-[15px]">{t.title}</b>
                <span className="ml-auto text-xs text-[var(--text-tertiary)]">{t.predictedCenter !== null ? `预测 ~${fmtViews(t.predictedCenter)}` : '预测没算出来'}</span>
              </div>
              <p className="mt-1 text-[var(--text-secondary)]">{t.why}</p>
              {t.copied > 0 && <p className="mt-1 text-xs text-[var(--warning)]">{`有 ${t.copied} 处和对标原文太像，改写后再用`}</p>}
              {open === t.id && (
                <div className="mt-2 space-y-1 rounded-[var(--r-md)] bg-[var(--bg-surface)] p-3">
                  <p className="text-xs text-[var(--text-tertiary)]">{`开头钩子：${t.hook}`}</p>
                  {t.script.segments.map((s) => (
                    <p key={s.id}>
                      <span className="mr-1 text-xs text-[var(--text-tertiary)]">{ROLE_LABEL[s.role]}</span>
                      {s.text}
                    </p>
                  ))}
                </div>
              )}
              {t.checklist.length > 0 && (
                <div className="mt-2">
                  <button className="text-xs text-[var(--accent)]" onClick={() => setTestOpen(testOpen === t.id ? null : t.id)}>{`实测清单（${t.checklist.length} 项）`}</button>
                  {testOpen === t.id && (
                    <div className="mt-2 space-y-2 rounded-[var(--r-md)] bg-[var(--bg-surface)] p-3">
                      {t.checklist.map((c, i) => {
                        const vals = draft[t.id] ?? t.results;
                        return (
                          <div key={i} className="space-y-1">
                            <div>{c.test}</div>
                            <div className="text-xs text-[var(--text-tertiary)]">{`记下：${c.record}`}</div>
                            <input
                              className="w-full rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1.5"
                              placeholder="填你实测的结果"
                              value={vals[i] ?? ''}
                              onChange={(e) => {
                                const next = t.checklist.map((_, k) => (k === i ? e.target.value : vals[k] ?? ''));
                                setDraft({ ...draft, [t.id]: next });
                              }}
                            />
                          </div>
                        );
                      })}
                      <button className="btn-secondary" disabled={busy === t.id || !(draft[t.id] ?? t.results).some((v) => (v ?? '').trim())} onClick={() => void rewrite(t)}>
                        {busy === t.id ? '正在按实测结果重写…' : '按实测结果重写'}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy === t.id} onClick={() => void act(t.id, 'adopt')}>就做这个</button>
                <button className="btn-secondary" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? '收起初稿' : '展开初稿'}</button>
                <button className="btn-secondary" disabled={busy === t.id} onClick={() => void act(t.id, 'dismiss')}>不要</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
