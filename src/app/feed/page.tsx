import type { ReactNode } from 'react';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { FEED_PAGE_SIZE, countByProvider, feedHref, loadFeedRows, parseFeedQuery, rankFeed, type FeedQuery } from '@/lib/overview/feed';
import { HotList, ScoreNote } from '@/components/overview/hot-feed';

export const dynamic = 'force-dynamic';

const RANGES: { id: string; label: string }[] = [
  { id: 'all', label: '全部时间' },
  { id: '1', label: '今天' },
  { id: '3', label: '3 天' },
  { id: '7', label: '7 天' },
  { id: '30', label: '30 天' },
];

const STATUSES: { id: string; label: string }[] = [
  { id: 'all', label: '全部状态' },
  { id: 'fresh', label: '还没写' },
  { id: 'draft', label: '有初稿' },
  { id: 'used', label: '已用过' },
  { id: 'adopted', label: '已做成作品' },
  { id: 'dismissed', label: '已忽略' },
];

const SORTS: { id: string; label: string }[] = [
  { id: 'score', label: '热度分' },
  { id: 'heat', label: '热度' },
  { id: 'new', label: '最新' },
];

function Chip({ href, on, children }: { href: string; on: boolean; children: ReactNode }) {
  return (
    <Link href={href} className={`inline-flex h-10 items-center rounded-full px-4 text-base ${on ? 'bg-[var(--accent)] font-semibold text-white' : 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-card)]'}`}>
      {children}
    </Link>
  );
}

export default async function FeedPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const now = new Date();
  const query = parseFeedQuery(searchParams);
  const all = await loadFeedRows(prisma, now);
  const ranked = rankFeed(all, query, now);
  const pages = Math.max(1, Math.ceil(ranked.length / FEED_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const start = (page - 1) * FEED_PAGE_SIZE;
  const rows = ranked.slice(start, start + FEED_PAGE_SIZE);
  const counts = countByProvider(all);
  const shown = query.page === page ? query : { ...query, page };

  return (
    <div className="h-full overflow-y-auto px-5 py-8 md:px-10">
      <div className="mx-auto max-w-[1120px]">
        <p className="text-base">
          <Link href="/" className="text-[var(--accent)]">
            今天写什么
          </Link>
        </p>
        <h1 className="page-title mt-3">热点</h1>
        <p className="mt-3 text-base leading-7">
          {`库里 ${all.length} 条都在这里，不按 3 天截断，也不按来源只留前几十条。`}
          {ranked.length !== all.length ? ` 当前显示 ${ranked.length} 条。` : ''}
        </p>
        <div className="mt-3">
          <ScoreNote />
        </div>

        <form action="/feed" className="mt-6 flex flex-wrap items-center gap-3">
          {shown.source !== 'all' && <input type="hidden" name="source" value={shown.source} />}
          {shown.range !== 'all' && <input type="hidden" name="range" value={shown.range} />}
          {shown.status !== 'all' && <input type="hidden" name="status" value={shown.status} />}
          {shown.sort !== 'score' && <input type="hidden" name="sort" value={shown.sort} />}
          <input
            name="q"
            defaultValue={shown.q}
            placeholder="搜标题或简介"
            className="h-11 w-full max-w-md rounded-xl bg-[var(--bg-surface)] px-4 text-base shadow-[var(--shadow-card)] outline-none"
          />
          <button className="btn-secondary h-11 px-5 text-base" type="submit">
            搜索
          </button>
        </form>

        <div className="mt-5 flex flex-wrap gap-2">
          <Chip href={feedHref(shown, { source: 'all' })} on={shown.source === 'all'}>
            {`全部 ${all.length}`}
          </Chip>
          {counts.map((c) => (
            <Chip key={c.provider} href={feedHref(shown, { source: c.provider })} on={shown.source === c.provider}>
              {`${c.label} ${c.count}`}
            </Chip>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <Chip key={r.id} href={feedHref(shown, { range: r.id })} on={shown.range === r.id}>
              {r.label}
            </Chip>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <Chip key={s.id} href={feedHref(shown, { status: s.id })} on={shown.status === s.id}>
              {s.label}
            </Chip>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SORTS.map((s) => (
            <Chip key={s.id} href={feedHref(shown, { sort: s.id })} on={shown.sort === s.id}>
              {s.label}
            </Chip>
          ))}
        </div>

        <div className="mt-6">
          {rows.length === 0 ? (
            <p className="max-w-[40rem] text-base leading-7">这个条件下没有条目。换来源、时间或状态，或者把搜索清掉。</p>
          ) : (
            <HotList rows={rows} startRank={start + 1} keyboard />
          )}
        </div>

        {pages > 1 && (
          <p className="mt-6 flex flex-wrap gap-4 text-base">
            {page > 1 && (
              <Link href={feedHref(shown, { page: page - 1 })} className="text-[var(--accent)]">
                上一页
              </Link>
            )}
            <span className="text-[var(--text-secondary)]">{`第 ${page} / ${pages} 页`}</span>
            {page < pages && (
              <Link href={feedHref(shown, { page: page + 1 })} className="text-[var(--accent)]">
                下一页
              </Link>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
