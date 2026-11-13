'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { IdeaCard } from '@/lib/overview/home';
import type { FeedRow } from '@/lib/overview/feed';
import { HotList, ScoreNote } from '@/components/overview/hot-feed';

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => ({ success: false, message: '服务没有响应' }));

export function HomeDesk({
  hot,
  totalHot,
  ideas,
  writing,
  account,
}: {
  hot: FeedRow[];
  totalHot: number;
  ideas: IdeaCard[];
  writing: { id: string; title: string }[];
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
    <div className="mx-auto max-w-[1120px] text-base leading-7">
      <h1 className="page-title">今天写什么</h1>
      <p className="mt-3 max-w-[68ch] text-base leading-7 text-[var(--text-secondary)]">先看热点和还没写的点子。下面是按热度分置顶的一批，其余在全部列表里。</p>
      <div className="mt-3">
        <ScoreNote />
      </div>
      {err && <p className="mt-4 text-base text-[var(--danger)]">{err}</p>}

      <div className="mt-8 grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.7fr)] lg:gap-12">
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[22px] font-extrabold tracking-tight">热点选题</h2>
            {totalHot > 0 && (
              <Link href="/feed" className="text-base text-[var(--accent)]">
                {`全部 ${totalHot} 条`}
              </Link>
            )}
          </div>
          {hot.length === 0 ? (
            <p className="mt-4 max-w-[40rem] text-base leading-7">
              还没有热点。每天 19:00 会从 GitHub、Hacker News 和 X 抓一批，终端也可以跑 <span className="whitespace-nowrap font-mono text-[15px]">npm run fetch:sources</span>。抓进来之后都会出现在这里，不再只留近 3 天或热度前 40 条。
            </p>
          ) : (
            <div className="mt-4">
              <HotList rows={hot} />
            </div>
          )}
        </section>

        <section className="lg:sticky lg:top-8">
          <h2 className="text-[22px] font-extrabold tracking-tight">待写的点子</h2>
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveIdea();
            }}
          >
            <textarea
              rows={3}
              className="w-full rounded-xl bg-[var(--bg-surface)] px-4 py-3 text-base leading-7 shadow-[var(--shadow-card)] outline-none"
              placeholder="记一句还没写的点子"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="btn-secondary mt-3 h-11 px-5 text-base" disabled={busy !== null || !draft.trim()} type="submit">
              {busy === 'new-idea' ? '存下…' : '先存着'}
            </button>
          </form>
          {ideas.length === 0 ? (
            <p className="mt-4 text-base leading-7">点子池是空的。上面写一句先存着，或者在热点上点「存点子」。</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {ideas.map((idea) => (
                <li key={idea.id} className="rounded-2xl bg-[var(--bg-surface)] px-5 py-4 shadow-[var(--shadow-card)]">
                  <p className="text-lg font-semibold leading-7">{idea.text}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-base text-[var(--text-secondary)]">{idea.status}</span>
                    <button className="btn-primary h-11 shrink-0 px-5 text-base" disabled={busy !== null} onClick={() => void writeIdea(idea)}>
                      {busy === idea.id ? '正在打开…' : idea.draftId ? '继续写' : '开始写'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {writing.length > 0 && (
        <section className="mt-12 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-lg font-extrabold">接着写</h2>
          <ul className="mt-2">
            {writing.map((w) => (
              <li key={w.id}>
                <Link href={`/projects/${w.id}`} className="block py-2 text-base hover:text-[var(--accent)]">
                  {w.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {account && <p className="mt-8 text-base text-[var(--text-secondary)]">{account}</p>}
    </div>
  );
}
