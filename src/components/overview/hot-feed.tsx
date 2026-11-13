'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FeedRow } from '@/lib/overview/feed';
import { HOT_SCORE, type ScorePart } from '@/lib/overview/hot-score';

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => ({ success: false, message: '服务没有响应' }));

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function ScoreNote() {
  const w = HOT_SCORE.weights;
  return (
    <p className="max-w-[68ch] text-base leading-7 text-[var(--text-secondary)]">
      {`热度分 = 热度 ${pct(w.heat)} + 新旧 ${pct(w.recency)} + 赛道 ${pct(w.fit)} + 亲测 ${pct(w.handsOn)}。热度按来源各自取对数：GitHub 是当前 stars，Hacker News 是 points，X 是库里的那一个整数，对标是相对平时的倍数。赛道只看标题和简介里有没有 AI、搞钱、工具。缺的字段不计入，权重分给其余项。没有历史热度，所以没有增速。点开分数能看到这一条怎么算的。`}
    </p>
  );
}

const BADGE: Record<string, string> = {
  github: 'bg-[var(--bg-elevated)] text-[var(--text-primary)]',
  hackernews: 'bg-[var(--accent-subtle)] text-[var(--accent)]',
  x: 'bg-[var(--info-subtle)] text-[var(--info)]',
  benchmark: 'bg-[var(--success-subtle)] text-[var(--success)]',
};

function PartLine({ part }: { part: ScorePart }) {
  if (part.value == null) {
    return (
      <p className="text-base leading-7">
        <span className="font-semibold">{part.label}</span>
        {` 不计。${part.detail}`}
      </p>
    );
  }
  return (
    <p className="text-base leading-7">
      <span className="font-semibold">{`${part.label} ${Math.round(part.value)}`}</span>
      {` × ${pct(part.applied)}。${part.detail}`}
    </p>
  );
}

export function HotList({ rows, startRank = 1, keyboard = false }: { rows: FeedRow[]; startRank?: number; keyboard?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSel((i) => Math.min(i, Math.max(0, rows.length - 1)));
  }, [rows.length]);

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

  useEffect(() => {
    if (!keyboard || rows.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const row = rows[sel];
      if (!row) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((i) => Math.min(rows.length - 1, i + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((i) => Math.max(0, i - 1));
      } else if (e.key === 'w') {
        e.preventDefault();
        void write(row);
      } else if (e.key === 'p' && row.canAdopt) {
        e.preventDefault();
        void adopt(row);
      } else if (e.key === 's') {
        e.preventDefault();
        void save(row);
      } else if (e.key === 'd') {
        e.preventDefault();
        void dismiss(row);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        setOpen((cur) => (cur === row.key ? null : row.key));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (rows.length === 0) return null;

  return (
    <div>
      {err && <p className="mb-3 text-base text-[var(--danger)]">{err}</p>}
      <ol className="overflow-hidden rounded-2xl bg-[var(--bg-surface)] shadow-[var(--shadow-card)]">
        {rows.map((row, i) => {
          const rank = startRank + i;
          const selected = keyboard && i === sel;
          const expanded = open === row.key;
          return (
            <li key={row.key} className={`border-t border-[var(--border-subtle)] first:border-t-0 ${selected ? 'bg-[var(--bg-surface-hover)]' : ''}`}>
              <div className="flex items-start gap-4 px-4 py-4 md:px-5">
                <div className="w-8 shrink-0 pt-1 text-lg font-semibold tabular-nums text-[var(--text-secondary)]">{String(rank).padStart(2, '0')}</div>
                <button
                  type="button"
                  className="w-12 shrink-0 pt-1 text-left text-xl font-extrabold tabular-nums leading-none text-[var(--text-primary)]"
                  aria-expanded={expanded}
                  aria-label={`${row.title} 的热度分 ${row.score.total}`}
                  onClick={() => setOpen(expanded ? null : row.key)}
                >
                  {row.score.total}
                </button>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className={`rounded-md px-2 py-0.5 text-[15px] font-semibold ${BADGE[row.provider] ?? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'}`}>{row.sourceLabel}</span>
                    <h3 className="min-w-0 text-lg font-semibold leading-7">{row.title}</h3>
                  </div>
                  <p className="mt-1 text-base leading-7 text-[var(--text-secondary)]">
                    {[row.heatLabel, row.seenLabel, row.status].filter(Boolean).join(' · ')}
                  </p>
                  {row.why && <p className="mt-1 max-w-[68ch] text-base leading-7">{row.why.length > 160 ? `${row.why.slice(0, 160)}…` : row.why}</p>}
                  <p className="mt-1 text-base text-[var(--text-secondary)]">{row.fit}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    {row.statusKey === 'dismissed' ? (
                      <button type="button" className="btn-secondary h-10 px-4 text-base" disabled={busy !== null} onClick={() => void dismiss(row)}>
                        {busy === `${row.key}:dismiss` ? '正在恢复…' : '恢复'}
                      </button>
                    ) : (
                      <>
                        <button type="button" className="btn-primary h-10 px-4 text-base" disabled={busy !== null} onClick={() => void (row.canAdopt ? adopt(row) : write(row))}>
                          {busy === row.key ? '正在打开…' : row.canAdopt ? '做成作品' : '开始写'}
                        </button>
                        <button type="button" className="text-base text-[var(--text-primary)] underline-offset-4 hover:underline disabled:opacity-50" disabled={busy !== null || saved.has(row.key)} onClick={() => void save(row)}>
                          {saved.has(row.key) ? '已存进点子' : busy === `${row.key}:save` ? '存下…' : '存点子'}
                        </button>
                        <button type="button" className="text-base text-[var(--text-secondary)] underline-offset-4 hover:underline disabled:opacity-50" disabled={busy !== null} onClick={() => void dismiss(row)}>
                          {busy === `${row.key}:dismiss` ? '忽略…' : '忽略'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              {expanded && (
                <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-inset)] px-5 py-4 md:pl-[5.5rem]">
                  <p className="text-base font-semibold">热度分 {row.score.total}</p>
                  <div className="mt-2 max-w-[68ch] space-y-2">
                    {row.score.parts.map((part) => (
                      <PartLine key={part.key} part={part} />
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {keyboard && <p className="mt-3 text-base text-[var(--text-secondary)]">j / k 移动，回车展开分数，w 开始写，p 做成作品，s 存点子，d 忽略。</p>}
    </div>
  );
}
