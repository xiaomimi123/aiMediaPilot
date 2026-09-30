'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PredictionsData } from '@/app/api/projects/[id]/predictions/route';
import { DIM_LABEL, type Dim } from '@/lib/predict/formula';
import { confidenceText, dragItems, KIND_LABEL } from '@/lib/predict/view';
import { cn } from '@/lib/utils';

const V: Record<string, string> = { good: '好', even: '平', bad: '差', na: '—' };
const M: Record<string, string> = { hook2s: '开头 2 秒跳出', hook5s: '前 5 秒完播', middle: '平均观看', ending: '完播率', like: '点赞率', favorite: '收藏率', share: '分享率', subscribe: '吸粉率' };

export function PredictionPanel({ projectId, onHighlight, onAskEditor, onChanged }: { projectId: string; onHighlight: (segmentId: string) => void; onAskEditor: (text: string) => void; onChanged: () => void }) {
  const [d, setD] = useState<PredictionsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const base = `/api/projects/${projectId}/predictions`;
  const load = useCallback(async () => {
    const j = await fetch(base).then((r) => r.json()).catch(() => ({ success: false, message: '读取预测失败' }));
    if (j.success) setD(j.data);
    else setErr(j.message);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);
  // 预测在后台跑: 每 3 秒看一次, 跑完通知工作区刷新(拿到对话里的通知)
  useEffect(() => {
    if (!d?.running) return;
    const t = setTimeout(async () => {
      await load();
      onChanged();
    }, 3000);
    return () => clearTimeout(t);
  }, [d, load, onChanged]);

  const start = async (kind: 'draft' | 'final' | 'recorded') => {
    setErr(null);
    const j = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    if (!j.success) setErr(j.message);
    await load();
  };

  if (!d) return <div className="text-xs text-[var(--text-tertiary)]">{err ?? '读取预测…'}</div>;
  const p = d.latest;
  const r = p?.result;
  const top = r?.buckets.length ? r.buckets.reduce((a, b) => (b.prob > a.prob ? b : a)) : null;
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-medium">流量预测</h3>
        {p && <span className="text-xs text-[var(--text-tertiary)]">{`${KIND_LABEL[p.kind]}${p.kind === 'draft' ? '' : ' · 已锁定'} · ${new Date(p.createdAt).toLocaleString('zh-CN')}`}</span>}
        <div className="flex-1" />
        {d.published ? (
          <span className="text-xs text-[var(--text-tertiary)]">已发布，不再预测（看「④ 发布与复盘」里的对账）</span>
        ) : (
          <>
            {d.canLockFinal && (
              <button className="text-xs text-[var(--accent)]" disabled={d.running} onClick={() => void start('final')}>补做定稿预测</button>
            )}
            {d.canLockRecorded && (
              <button className="text-xs text-[var(--accent)]" disabled={d.running} onClick={() => void start('recorded')}>补做录制后预测</button>
            )}
            <button className="rounded-md border border-[var(--border-strong)] px-3 py-1 text-xs disabled:opacity-50" disabled={d.running} onClick={() => void start('draft')}>
              {d.running ? '预测中…' : '预测'}
            </button>
          </>
        )}
      </div>
      {err && <p className="mb-2 text-xs text-[var(--danger)]">{err}</p>}
      {!p || !r ? (
        <p className="text-xs text-[var(--text-tertiary)]">还没有预测。点「预测」按当前稿子打分，定稿和录完口播后会自动各锁定一版。</p>
      ) : (
        <div className="space-y-3">
          {r.center === null ? (
            <p className="text-xs text-[var(--text-secondary)]">公开作品少于 3 条，暂不预测数字，先看打分和拖后腿的地方。</p>
          ) : (
            <div>
              <div>{`中枢约 ${r.center.toLocaleString('en-US')}，最可能 ${top!.label}（${top!.prob}%）`}</div>
              <div className="mt-2 space-y-1">
                {r.buckets.map((b) => (
                  <div key={b.label} className="flex items-center gap-2 text-xs">
                    <span className="w-28 shrink-0 font-mono text-[var(--text-secondary)]">{b.label}</span>
                    <div className="h-2 flex-1 rounded bg-[var(--bg-inset)]">
                      <div className="h-2 rounded bg-[var(--accent)]" style={{ width: `${b.prob}%` }} />
                    </div>
                    <span className="w-10 text-right font-mono">{b.prob}%</span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">{confidenceText(r)}</p>
            </div>
          )}
          <ul className="space-y-1 text-xs">
            {p.scores.map((s) => (
              <li key={s.dim}>
                <span className={cn('font-medium', s.score <= 2 && 'text-[var(--danger)]')}>{`${DIM_LABEL[s.dim as Dim]} ${s.score} 分`}</span>
                {`：${s.reason}`}
                {s.quote && (
                  <button className="ml-1 text-[var(--accent)] underline" onClick={() => s.segmentId && onHighlight(s.segmentId)}>
                    {`「${s.quote}」`}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {r.center !== null && (
            <p className="text-xs text-[var(--text-secondary)]">
              {r.metrics.filter((m) => m.verdict !== 'na').map((m) => `${M[m.key]} ${V[m.verdict]}`).join(' · ') || '各项指标还没有基线'}
            </p>
          )}
          {dragItems(p.scores).length > 0 && (
            <div className="space-y-1 rounded-md bg-[var(--bg-inset)] p-2 text-xs">
              <div className="text-[var(--text-tertiary)]">拖后腿</div>
              {dragItems(p.scores).map((s) => (
                <div key={s.dim} className="flex flex-wrap items-center gap-2">
                  <span>{`${DIM_LABEL[s.dim as Dim]}：${s.fix || s.reason}`}</span>
                  <button className="text-[var(--accent)]" onClick={() => onAskEditor(`按预测的建议改「${DIM_LABEL[s.dim as Dim]}」：${s.fix || s.reason}`)}>
                    让编导按这个改
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
