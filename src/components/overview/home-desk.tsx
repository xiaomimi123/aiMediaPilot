'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { IdeaCard, SourceStat } from '@/lib/overview/home';
import type { TopicCluster } from '@/lib/overview/cluster';
import { HomePicks } from '@/components/overview/hot-feed';

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => ({ success: false, message: '服务没有响应' }));

function Panel({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="rounded-2xl bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-extrabold">{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function HomeDesk({
  picks,
  totalHot,
  ideas,
  writing,
  sources,
  fetchLine,
  account,
}: {
  picks: TopicCluster[];
  totalHot: number;
  ideas: IdeaCard[];
  writing: { id: string; title: string }[];
  sources: SourceStat[];
  fetchLine: string;
  account: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

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

  const writeIdea = (idea: IdeaCard) =>
    run(idea.id, async () => {
      if (idea.draftId) {
        router.push(`/drafts?draft=${idea.draftId}`);
        return;
      }
      const j = await post('/api/drafts', { ideaId: idea.id });
      if (!j.success) throw new Error(j.message);
      router.push(`/drafts?draft=${j.data.id}`);
    });

  const saveIdea = () =>
    run('new-idea', async () => {
      const text = draft.trim();
      if (!text) return;
      const j = await post('/api/topics/ideas', { text });
      if (!j.success) throw new Error(j.message);
      setDraft('');
      router.refresh();
    });

  return (
    <div className="flex h-full flex-col px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="page-title">今天最值得写</h1>
        <p className="text-[15px] leading-6 text-[var(--text-secondary)]">同一件事收成一条，大约 10 条。其余在全部里。</p>
        {totalHot > 0 && (
          <Link href="/feed" className="ml-auto text-[15px] text-[var(--accent)]">
            {`全部 ${totalHot} 条`}
          </Link>
        )}
      </div>
      {err && <p className="mt-2 text-[15px] text-[var(--danger)]">{err}</p>}

      <div className="mt-3 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-4">
        <section className="flex min-h-0 flex-col rounded-2xl bg-[var(--bg-surface)] shadow-[var(--shadow-card)]">
          <div className="min-h-0 flex-1 overflow-auto">
            {picks.length === 0 ? (
              <p className="px-4 py-4 text-[15px] leading-6">还没有值得写的。每天 19:00 会从 GitHub、Hacker News、X 和 Reddit 抓一批，终端也可以跑 npm run fetch:sources。</p>
            ) : (
              <HomePicks picks={picks} />
            )}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-3 overflow-auto">
          <Panel title="待写的点子">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveIdea();
              }}
            >
              <textarea
                rows={2}
                className="w-full rounded-lg bg-[var(--bg-inset)] px-3 py-2 text-[15px] leading-6 outline-none"
                placeholder="记一句还没写的点子"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button className="btn-secondary mt-2 h-8 px-3 text-[15px]" disabled={busy !== null || !draft.trim()} type="submit">
                {busy === 'new-idea' ? '存下…' : '先存着'}
              </button>
            </form>
            {ideas.length === 0 ? (
              <p className="mt-2 text-[15px] leading-6">点子池是空的。</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {ideas.map((idea) => (
                  <li key={idea.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold leading-6">{idea.text}</p>
                      <p className="text-[15px] leading-6 text-[var(--text-secondary)]">{idea.status}</p>
                    </div>
                    <button className="btn-primary h-8 shrink-0 px-3 text-[15px]" disabled={busy !== null} onClick={() => void writeIdea(idea)}>
                      {busy === idea.id ? '打开…' : idea.draftId ? '继续写' : '开始写'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="接着写">
            {writing.length === 0 ? (
              <p className="text-[15px] leading-6">没有进行中的作品。</p>
            ) : (
              <ul>
                {writing.map((w) => (
                  <li key={w.id}>
                    <Link href={`/projects/${w.id}`} className="block py-1 text-[15px] leading-6 hover:text-[var(--accent)]">
                      {w.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="信息源">
            <table className="w-full text-[15px] leading-6">
              <tbody>
                {sources.map((s) => (
                  <tr key={s.label}>
                    <td className="py-0.5 pr-2">{s.label}</td>
                    <td className="py-0.5 text-right tabular-nums font-semibold">{s.count}</td>
                    <td className="py-0.5 pl-3 text-right text-[var(--text-secondary)]">{s.newest ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[15px] leading-6 text-[var(--text-secondary)]">{fetchLine}</p>
          </Panel>

          {account && <p className="px-1 text-[15px] leading-6 text-[var(--text-secondary)]">{account}</p>}
        </aside>
      </div>
    </div>
  );
}
