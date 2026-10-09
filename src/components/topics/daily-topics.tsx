'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DailyCard } from '@/lib/topics/daily';
import { fmtViews } from '@/lib/predict/formula';
import { ROLE_LABEL } from '@/lib/script/model';

type Data = { topics: DailyCard[]; lastRun: { day: string; created: number; reasons: string[] } | null };

export function DailyTopics() {
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const j = await fetch('/api/topics/daily').then((r) => r.json()).catch(() => ({ success: false }));
    setD(j.success ? j.data : { topics: [], lastRun: null });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

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
        <p className="text-sm text-[var(--text-secondary)]">{d.lastRun?.reasons[0] ?? '今晚 23:00 会自动生成；也可以在「设置 · 每晚任务」立即运行'}</p>
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
