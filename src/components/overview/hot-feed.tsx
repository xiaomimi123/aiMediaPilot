'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FeedRow } from '@/lib/overview/feed';
import { clusterSources, whyLine, type TopicCluster } from '@/lib/overview/cluster';
import { formulaLine } from '@/lib/overview/hot-score';
import type { ScorePart } from '@/lib/overview/hot-score';

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => ({ success: false, message: '服务没有响应' }));

const SOURCE_COLOR: Record<string, string> = {
  hackernews: 'text-[var(--accent)]',
  x: 'text-[var(--info)]',
  reddit: 'text-[var(--soft)]',
  benchmark: 'text-[var(--success)]',
};

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

function Badges({ cluster }: { cluster: TopicCluster }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      {clusterSources(cluster).map((source) => (
        <span key={source.provider} className={`text-[13px] font-semibold ${SOURCE_COLOR[source.provider] ?? ''}`}>
          {source.label}
        </span>
      ))}
    </span>
  );
}

function metaLine(row: FeedRow): string {
  return [whyLine(row), row.seenLabel, row.status].filter(Boolean).join(' · ');
}

export function HomePicks({ picks }: { picks: TopicCluster[] }) {
  const { busy, err, write, adopt } = useRowActions();
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (picks.length === 0) return null;
  return (
    <div>
      {err && <p className="px-4 py-2 text-[15px] text-[var(--danger)]">{err}</p>}
      <ul>
        {picks.map((cluster) => {
          const expanded = open.has(cluster.id);
          return (
            <li key={cluster.id} className="border-t border-[var(--border-subtle)] px-4 py-3 first:border-t-0">
              <div className="flex items-start gap-4">
                <div className="w-10 pt-0.5 text-xl font-extrabold tabular-nums">{cluster.lead.score.total}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold leading-6">{cluster.lead.title}</p>
                  <p className="truncate text-[14px] leading-6 text-[var(--text-secondary)]">{metaLine(cluster.lead)}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badges cluster={cluster} />
                    {cluster.related.length > 0 && (
                      <button
                        type="button"
                        className="text-[14px] text-[var(--text-secondary)] underline-offset-2 hover:underline"
                        onClick={() =>
                          setOpen((prev) => {
                            const next = new Set(prev);
                            if (next.has(cluster.id)) next.delete(cluster.id);
                            else next.add(cluster.id);
                            return next;
                          })
                        }
                      >
                        {expanded ? '收起' : `+${cluster.related.length} 相关`}
                      </button>
                    )}
                  </div>
                </div>
                <Primary row={cluster.lead} busy={busy} onWrite={write} onAdopt={adopt} />
              </div>
              {expanded && (
                <ul className="mt-2 space-y-2 pl-14">
                  {cluster.related.map((row) => (
                    <li key={row.key} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] leading-6">{row.title}</p>
                        <p className="truncate text-[14px] leading-6 text-[var(--text-secondary)]">{`${row.sourceLabel} · ${metaLine(row)}`}</p>
                      </div>
                      <Primary row={row} busy={busy} onWrite={write} onAdopt={adopt} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function sectionLabel(cluster: TopicCluster, groupBy: 'source' | 'date'): string {
  return groupBy === 'source' ? cluster.lead.sourceLabel : cluster.lead.seenLabel || '更早';
}

export function FeedBoard({ clusters, groupBy, initialKey = null }: { clusters: TopicCluster[]; groupBy: 'source' | 'date'; initialKey?: string | null }) {
  const { busy, err, saved, write, adopt, dismiss, save } = useRowActions();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const visible = clusters.flatMap((cluster) => [cluster.lead, ...(expanded.has(cluster.id) ? cluster.related : [])]);
  const [selKey, setSelKey] = useState<string | null>(initialKey);
  const selected = visible.find((row) => row.key === selKey) ?? visible[0] ?? null;
  const api = useRef({ write, adopt, save, dismiss, visible, selKey });
  api.current = { write, adopt, save, dismiss, visible, selKey };

  useEffect(() => {
    if (initialKey) setSelKey(initialKey);
  }, [initialKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const cur = api.current;
      const index = cur.visible.findIndex((row) => row.key === cur.selKey);
      const row = cur.visible[index] ?? cur.visible[0];
      if (!row) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = cur.visible[Math.min(cur.visible.length - 1, Math.max(0, index) + 1)];
        if (next) setSelKey(next.key);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = cur.visible[Math.max(0, (index < 0 ? 0 : index) - 1)];
        if (next) setSelKey(next.key);
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

  if (clusters.length === 0 || !selected) return null;
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  let previous = '';

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-4">
      <div className="min-h-0 overflow-auto rounded-2xl bg-[var(--bg-surface)] shadow-[var(--shadow-card)]">
        {err && <p className="px-4 py-2 text-[15px] text-[var(--danger)]">{err}</p>}
        <ul>
          {clusters.map((cluster) => {
            const label = sectionLabel(cluster, groupBy);
            const header = label !== previous;
            previous = label;
            const on = cluster.lead.key === selected.key;
            const isOpen = expanded.has(cluster.id);
            return (
              <li key={cluster.id}>
                {header && <h2 className="border-t border-[var(--border-subtle)] px-4 pb-1 pt-4 text-[14px] font-semibold text-[var(--text-secondary)] first:border-t-0">{label}</h2>}
                <div className={`flex items-start gap-3 px-4 py-2.5 ${on ? 'bg-[var(--accent-subtle)]' : 'cursor-pointer hover:bg-[var(--bg-surface-hover)]'}`} onClick={() => setSelKey(cluster.lead.key)}>
                  <div className="w-9 pt-0.5 text-base font-extrabold tabular-nums">{cluster.lead.score.total}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold leading-6">{cluster.lead.title}</p>
                    <p className="truncate text-[14px] leading-5 text-[var(--text-secondary)]">{metaLine(cluster.lead)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <Badges cluster={cluster} />
                    {cluster.related.length > 0 && (
                      <button type="button" className="text-[14px] text-[var(--text-secondary)] underline-offset-2 hover:underline" onClick={() => toggle(cluster.id)}>
                        {isOpen ? '收起' : `+${cluster.related.length} 相关`}
                      </button>
                    )}
                    {cluster.lead.statusKey === 'dismissed' ? (
                      <button type="button" className="text-[15px] underline-offset-2 hover:underline" disabled={busy !== null} onClick={() => void dismiss(cluster.lead)}>
                        {busy === `${cluster.lead.key}:dismiss` ? '恢复…' : '恢复'}
                      </button>
                    ) : (
                      <Primary row={cluster.lead} busy={busy} onWrite={write} onAdopt={adopt} />
                    )}
                  </div>
                </div>
                {isOpen &&
                  cluster.related.map((row) => (
                    <div key={row.key} className={`flex items-center gap-3 py-2 pl-16 pr-4 ${row.key === selected.key ? 'bg-[var(--accent-subtle)]' : 'cursor-pointer hover:bg-[var(--bg-surface-hover)]'}`} onClick={() => setSelKey(row.key)}>
                      <p className="min-w-0 flex-1 truncate text-[14px] leading-6 text-[var(--text-secondary)]">{`${row.sourceLabel} · ${row.title}`}</p>
                    </div>
                  ))}
              </li>
            );
          })}
        </ul>
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
