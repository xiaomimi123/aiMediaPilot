import type { ReactNode } from 'react';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { FEED_PAGE_SIZE, countByProvider, feedHref, loadFeedRows, parseFeedQuery, rankFeed } from '@/lib/overview/feed';
import { FeedBoard } from '@/components/overview/hot-feed';

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
    <Link href={href} className={`inline-flex h-8 items-center rounded-full px-3 text-[15px] ${on ? 'bg-[var(--accent)] font-semibold text-white' : 'bg-[var(--bg-surface)] text-[var(--text-primary)]'}`}>
      {children}
    </Link>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '');

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
    <div className="flex h-full flex-col px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="page-title">热点</h1>
        <p className="text-[15px] leading-6">
          <Link href="/" className="text-[var(--accent)]">
            今天写什么
          </Link>
          {` · 库里 ${all.length} 条`}
          {ranked.length !== all.length ? `，当前 ${ranked.length} 条` : ''}
        </p>
        {pages > 1 && (
          <p className="ml-auto flex gap-3 text-[15px]">
            {page > 1 && (
              <Link href={feedHref(shown, { page: page - 1 })} className="text-[var(--accent)]">
                上一页
              </Link>
            )}
            <span>{`第 ${page} / ${pages} 页`}</span>
            {page < pages && (
              <Link href={feedHref(shown, { page: page + 1 })} className="text-[var(--accent)]">
                下一页
              </Link>
            )}
          </p>
        )}
      </div>

      <form action="/feed" className="mt-3 flex flex-wrap items-center gap-2">
        {shown.source !== 'all' && <input type="hidden" name="source" value={shown.source} />}
        {shown.range !== 'all' && <input type="hidden" name="range" value={shown.range} />}
        {shown.status !== 'all' && <input type="hidden" name="status" value={shown.status} />}
        {shown.sort !== 'score' && <input type="hidden" name="sort" value={shown.sort} />}
        <input name="q" defaultValue={shown.q} placeholder="搜标题或简介" className="h-8 w-56 rounded-lg bg-[var(--bg-surface)] px-3 text-[15px] outline-none" />
        <button className="btn-secondary h-8 px-3 text-[15px]" type="submit">
          搜索
        </button>
        <Chip href={feedHref(shown, { source: 'all' })} on={shown.source === 'all'}>{`全部 ${all.length}`}</Chip>
        {counts.map((c) => (
          <Chip key={c.provider} href={feedHref(shown, { source: c.provider })} on={shown.source === c.provider}>
            {`${c.label} ${c.count}`}
          </Chip>
        ))}
        {RANGES.map((r) => (
          <Chip key={r.id} href={feedHref(shown, { range: r.id })} on={shown.range === r.id}>
            {r.label}
          </Chip>
        ))}
        {STATUSES.map((s) => (
          <Chip key={s.id} href={feedHref(shown, { status: s.id })} on={shown.status === s.id}>
            {s.label}
          </Chip>
        ))}
        {SORTS.map((s) => (
          <Chip key={s.id} href={feedHref(shown, { sort: s.id })} on={shown.sort === s.id}>
            {s.label}
          </Chip>
        ))}
      </form>

      <div className="mt-3 min-h-0 flex-1">
        {rows.length === 0 ? (
          <p className="text-[15px] leading-6">这个条件下没有条目。</p>
        ) : (
          <FeedBoard rows={rows} startRank={start + 1} initialKey={one(searchParams.row) || null} />
        )}
      </div>
    </div>
  );
}
