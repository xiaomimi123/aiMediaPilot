'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FeedRow } from '@/lib/overview/feed';
import { formulaLine } from '@/lib/overview/hot-score';
import type { ScorePart } from '@/lib/overview/hot-score';

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => ({ success: false, message: '服务没有响应' }));

const SOURCE_COLOR: Record<string, string> = {
  hackernews: 'text-[var(--accent)]',
  x: 'text-[var(--info)]',
  benchmark: 'text-[var(--success)]',
};

const fitShort = (row: FeedRow) => (row.provider === 'github' ? '口播·横版' : '口播');

function useRowActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const run = async (key: string, job: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setErr(null);
    try {
      await job();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '没有做成');
    } finally {
      setBusy(null);
    }
  };

  const write = (row: FeedRow) =>
    run(row.key, async () => {
      const body = [row.why, [row.sourceLabel, row.heatLabel].filter(Boolean).join(' · '), row.url].filter(Boolean).join('\n');
      const j = await post('/api/drafts', { title: row.title.slice(0, 100), body, source: 'blank' });
      if (!j.success) throw new Error(j.message ?? '没有开成稿');
      router.push(`/drafts?draft=${j.data.id}`);
    });

  const adopt = (row: FeedRow) =>
    run(row.key, async () => {
      if (!row.dailyId) return;
      const j = await post(`/api/topics/daily/${row.dailyId}`, { action: 'adopt' });
      if (!j.success) throw new Error(j.message ?? '没有建成作品');
      router.push(`/projects/${j.data.projectId}`);
    });

  const dismiss = (row: FeedRow) =>
    run(`${row.key}:dismiss`, async () => {
      const j = await post('/api/feed', { action: row.statusKey === 'dismissed' ? 'restore' : 'dismiss', kind: row.kind, id: row.refId });
      if (!j.success) throw new Error(j.message ?? '没有改成');
      router.refresh();
    });

  const save = (row: FeedRow) =>
    run(`${row.key}:save`, async () => {
      const text = [row.title, row.why, row.url].filter(Boolean).join('\n');
      const j = await post('/api/topics/ideas', { text });
      if (!j.success) throw new Error(j.message ?? '没有存下');
      setSaved((prev) => new Set(prev).add(row.key));
      router.refresh();
    });

  return { busy, err, saved, write, adopt, dismiss, save };
}

function Primary({ row, busy, onWrite, onAdopt }: { row: FeedRow; busy: string | null; onWrite: (r: FeedRow) => void; onAdopt: (r: FeedRow) => void }) {
  if (row.statusKey === 'dismissed') return null;
  return (
    <button type="button" className="btn-primary h-8 px-3 text-[15px]" disabled={busy !== null} onClick={() => void (row.canAdopt ? onAdopt(row) : onWrite(row))}>
      {busy === row.key ? '打开…' : row.canAdopt ? '做成作品' : '开始写'}
    </button>
  );
}

function PartLine({ part }: { part: ScorePart }) {
  if (part.value == null) {
    return (
      <p className="text-[15px] leading-6">
        <span className="font-semibold">{part.label}</span>
        {` 不计。${part.detail}`}
      </p>
    );
  }
  return (
    <p className="text-[15px] leading-6">
      <span className="font-semibold">{`${part.label} ${Math.round(part.value)}`}</span>
      {` × ${Math.round(part.applied * 100)}%。${part.detail}`}
    </p>
  );
}

const th = 'sticky top-0 bg-[var(--bg-surface)] px-2 py-2 text-left text-[15px] font-semibold';
const td = 'border-t border-[var(--border-subtle)] px-2 py-2 align-top';

function Cols({ withFit }: { withFit: boolean }) {
  return (
    <colgroup>
      <col className="w-10" />
      <col className="w-12" />
      <col />
      <col className="w-[132px]" />
      <col className="w-[112px]" />
      {withFit && <col className="w-14" />}
      <col className="w-[76px]" />
      {withFit && <col className="w-[104px]" />}
      <col className="w-[96px]" />
    </colgroup>
  );
}

export function HomeTable({ rows }: { rows: FeedRow[] }) {
  const { busy, err, write, adopt } = useRowActions();
  if (rows.length === 0) return null;
  return (
    <div>
      {err && <p className="px-3 py-2 text-[15px] text-[var(--danger)]">{err}</p>}
      <table className="w-full table-fixed border-collapse text-[15px] leading-6">
        <Cols withFit={false} />
        <thead>
          <tr>
            <th className={th}>序</th>
            <th className={th}>分</th>
            <th className={th}>标题</th>
            <th className={th}>来源</th>
            <th className={th}>热度</th>
            <th className={th}>状态</th>
            <th className={th}>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.key} className="hover:bg-[var(--bg-surface-hover)]">
              <td className={`${td} tabular-nums text-[var(--text-secondary)]`}>{String(i + 1).padStart(2, '0')}</td>
              <td className={`${td} text-base font-extrabold tabular-nums`}>{row.score.total}</td>
              <td className={td}>
                <div className="truncate font-semibold">{row.title}</div>
                {row.why && <div className="line-clamp-2 text-[var(--text-secondary)]">{row.why}</div>}
              </td>
              <td className={`${td} whitespace-nowrap font-semibold ${SOURCE_COLOR[row.provider] ?? ''}`}>{row.sourceLabel}</td>
              <td className={`${td} truncate tabular-nums`}>{row.heatLabel ?? '—'}</td>
              <td className={`${td} truncate`}>{row.status}</td>
              <td className={td}>
                <Primary row={row} busy={busy} onWrite={write} onAdopt={adopt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FeedBoard({ rows, startRank = 1, initialKey = null }: { rows: FeedRow[]; startRank?: number; initialKey?: string | null }) {
  const { busy, err, saved, write, adopt, dismiss, save } = useRowActions();
  const [sel, setSel] = useState(() => Math.max(0, rows.findIndex((r) => r.key === initialKey)));
  const selected = rows[sel] ?? rows[0] ?? null;
  const api = useRef({ write, adopt, save, dismiss, rows, sel });
  api.current = { write, adopt, save, dismiss, rows, sel };

  useEffect(() => {
    setSel((i) => {
      const hit = initialKey ? rows.findIndex((r) => r.key === initialKey) : -1;
      if (hit >= 0) return hit;
      return Math.min(i, Math.max(0, rows.length - 1));
    });
  }, [rows, initialKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const cur = api.current;
      const row = cur.rows[cur.sel];
      if (!row) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((i) => Math.min(cur.rows.length - 1, i + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((i) => Math.max(0, i - 1));
      } else if (e.key === 'w') {
        e.preventDefault();
        void cur.write(row);
      } else if (e.key === 'p' && row.canAdopt) {
        e.preventDefault();
        void cur.adopt(row);
      } else if (e.key === 's') {
        e.preventDefault();
        void cur.save(row);
      } else if (e.key === 'd') {
        e.preventDefault();
        void cur.dismiss(row);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (rows.length === 0 || !selected) return null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-4">
      <div className="min-h-0 overflow-auto rounded-2xl bg-[var(--bg-surface)] shadow-[var(--shadow-card)]">
        {err && <p className="px-3 py-2 text-[15px] text-[var(--danger)]">{err}</p>}
        <table className="w-full table-fixed border-collapse text-[15px] leading-6">
          <Cols withFit />
          <thead>
            <tr>
              <th className={th}>序</th>
              <th className={th}>分</th>
              <th className={th}>标题</th>
              <th className={th}>来源</th>
              <th className={th}>热度</th>
              <th className={th}>时间</th>
              <th className={th}>状态</th>
              <th className={th}>平台</th>
              <th className={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const on = row.key === selected.key;
              return (
                <tr key={row.key} className={on ? 'bg-[var(--accent-subtle)]' : 'cursor-pointer hover:bg-[var(--bg-surface-hover)]'} onClick={() => setSel(i)}>
                  <td className={`${td} tabular-nums text-[var(--text-secondary)]`}>{String(startRank + i).padStart(2, '0')}</td>
                  <td className={`${td} text-base font-extrabold tabular-nums`}>{row.score.total}</td>
                  <td className={td}>
                    <div className="truncate font-semibold">{row.title}</div>
                    {row.why && <div className="truncate text-[var(--text-secondary)]">{row.why}</div>}
                  </td>
                  <td className={`${td} whitespace-nowrap font-semibold ${SOURCE_COLOR[row.provider] ?? ''}`}>{row.sourceLabel}</td>
                  <td className={`${td} truncate tabular-nums`}>{row.heatLabel ?? '—'}</td>
                  <td className={`${td} truncate`}>{row.seenLabel || '—'}</td>
                  <td className={`${td} truncate`}>{row.status}</td>
                  <td className={`${td} truncate`}>{fitShort(row)}</td>
                  <td className={td} onClick={(e) => e.stopPropagation()}>
                    {row.statusKey === 'dismissed' ? (
                      <button type="button" className="text-[15px] underline-offset-2 hover:underline" disabled={busy !== null} onClick={() => void dismiss(row)}>
                        {busy === `${row.key}:dismiss` ? '恢复…' : '恢复'}
                      </button>
                    ) : (
                      <Primary row={row} busy={busy} onWrite={write} onAdopt={adopt} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <aside className="min-h-0 overflow-auto rounded-2xl bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]">
        <p className="text-[15px] leading-6 text-[var(--text-secondary)]">{formulaLine()}</p>
        <p className="mt-4 text-base font-extrabold tabular-nums">热度分 {selected.score.total}</p>
        <h2 className="mt-1 text-lg font-semibold leading-7">{selected.title}</h2>
        <p className="mt-2 text-[15px] leading-6">
          {[selected.sourceLabel, selected.heatLabel, selected.seenLabel, selected.status, selected.fit].filter(Boolean).join(' · ')}
        </p>
        {selected.why && <p className="mt-3 text-[15px] leading-6">{selected.why}</p>}
        {selected.url && (
          <a className="mt-2 block truncate text-[15px] text-[var(--accent)]" href={selected.url} target="_blank" rel="noreferrer">
            {selected.url}
          </a>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          {selected.statusKey !== 'dismissed' && (
            <>
              <button type="button" className="text-[15px] underline-offset-2 hover:underline disabled:opacity-50" disabled={busy !== null || saved.has(selected.key)} onClick={() => void save(selected)}>
                {saved.has(selected.key) ? '已存进点子' : '存进点子池'}
              </button>
              <button type="button" className="text-[15px] text-[var(--text-secondary)] underline-offset-2 hover:underline" disabled={busy !== null} onClick={() => void dismiss(selected)}>
                忽略这条
              </button>
            </>
          )}
        </div>
        <div className="mt-4 space-y-3 border-t border-[var(--border-subtle)] pt-4">
          {selected.score.parts.map((part) => (
            <PartLine key={part.key} part={part} />
          ))}
        </div>
        <p className="mt-4 text-[15px] leading-6 text-[var(--text-secondary)]">j / k 换行，w 开始写，p 做成作品，s 存点子，d 忽略。</p>
      </aside>
    </div>
  );
}
