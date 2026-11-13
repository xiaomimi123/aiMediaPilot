import type { PrismaClient } from '@prisma/client';
import { scoreHot, type HotScore } from './hot-score';

/**
 * 首页和 /feed 共用的信息源列表。
 *
 * 以前首页会丢掉行，这里逐条不再做：
 * - 不限「近 3 天」。freshItems 用 day >= 今天-3，而抓取更新时不改 day，旧条目热度刷新了也会消失。
 * - 不按热度取前 40。star 和 points 混在一个整数里比，低分的 Hacker News 整源被挤掉。
 * - 不因为已经做成每日选题就把原条目藏起来。
 * - 首页只是置顶，其余在 /feed，不再链到不列出这些行的选题页。
 *
 * 抓取本身仍有上限（GitHub 两次搜索各 20 条、HN 首页 30 条、X 原创前 30 条）。那是入库前的事，列表把库里有的都算上。
 */

export const HOME_PIN = 12;
export const FEED_PAGE_SIZE = 30;

const FIT_DOUYIN = '抖音口播';
const FIT_GITHUB = '抖音口播 · 录操作用横版';

export const SOURCE_LABEL: Record<string, string> = {
  github: 'GitHub',
  hackernews: 'Hacker News',
  x: 'X',
  benchmark: '抖音对标',
  sequel: '续集',
  idea: '点子',
};

export type StatusKey = 'fresh' | 'used' | 'draft' | 'adopted' | 'dismissed';

export interface FeedRow {
  key: string;
  kind: 'source' | 'benchmark' | 'daily';
  refId: string;
  dailyId: string | null;
  provider: string;
  sourceLabel: string;
  title: string;
  why: string | null;
  url: string | null;
  heat: number | null;
  heatLabel: string | null;
  seenAt: string | null;
  seenLabel: string;
  statusKey: StatusKey;
  status: string;
  fit: string;
  score: HotScore;
  canAdopt: boolean;
}

export interface FeedQuery {
  q: string;
  source: string;
  range: string;
  status: string;
  sort: string;
  page: number;
}

const STATUS_LABEL: Record<StatusKey, string> = {
  fresh: '还没写',
  used: '已用过',
  draft: '有初稿',
  adopted: '已做成作品',
  dismissed: '已忽略',
};

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '');

export function parseFeedQuery(sp: Record<string, string | string[] | undefined>): FeedQuery {
  const source = one(sp.source);
  const range = one(sp.range);
  const status = one(sp.status);
  const sort = one(sp.sort);
  const page = Number(one(sp.page));
  return {
    q: one(sp.q).trim(),
    source: ['github', 'hackernews', 'x', 'benchmark', 'sequel', 'idea'].includes(source) ? source : 'all',
    range: ['1', '3', '7', '30'].includes(range) ? range : 'all',
    status: ['fresh', 'used', 'draft', 'adopted', 'dismissed', 'open'].includes(status) ? status : 'all',
    sort: ['heat', 'new'].includes(sort) ? sort : 'score',
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
  };
}

export function feedHref(q: FeedQuery, patch: Partial<FeedQuery> = {}): string {
  const next = { ...q, page: patch.page ?? (patch.sort || patch.source || patch.range || patch.status || patch.q != null ? 1 : q.page), ...patch };
  const p = new URLSearchParams();
  if (next.q) p.set('q', next.q);
  if (next.source !== 'all') p.set('source', next.source);
  if (next.range !== 'all') p.set('range', next.range);
  if (next.status !== 'all') p.set('status', next.status);
  if (next.sort !== 'score') p.set('sort', next.sort);
  if (next.page > 1) p.set('page', String(next.page));
  const s = p.toString();
  return s ? `/feed?${s}` : '/feed';
}

function plain(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x2F;/gi, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || /^https?:\/\/\S+$/.test(t)) return null;
  return t;
}

function seenLabel(seenAt: string | null, now: Date): string {
  if (!seenAt) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(seenAt);
  const t = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : Date.parse(seenAt);
  if (Number.isNaN(t)) return '';
  const age = (now.getTime() - t) / 86_400_000;
  if (age < 1) return '今天';
  if (age < 2) return '昨天';
  if (age < 8) return `${Math.floor(age)} 天前`;
  return `${m?.[2] ?? ''}-${m?.[3] ?? ''}`.replace(/^-|-$/g, '') || seenAt.slice(0, 10);
}

function heatLabel(provider: string, heat: number | null): string | null {
  if (heat == null) return null;
  const n = heat.toLocaleString('en-US');
  if (provider === 'github') return `${n} stars`;
  if (provider === 'hackernews') return `${n} points`;
  if (provider === 'benchmark') return `平时的 ${n} 倍`;
  if (provider === 'x') return `${n} 热度`;
  return n;
}

const fitOf = (provider: string) => (provider === 'github' ? FIT_GITHUB : FIT_DOUYIN);

function pillarNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object' || !('name' in p)) continue;
    const name = String((p as { name: unknown }).name ?? '').trim();
    if (name.length >= 2 && name.length <= 16) out.push(name);
  }
  return out;
}

interface DailyRef {
  id: string;
  status: string;
  title: string;
  why: string;
  source: string;
  sourceId: string;
  day: string;
}

function rowFrom(
  partial: Omit<FeedRow, 'score' | 'seenLabel' | 'status' | 'heatLabel' | 'fit' | 'sourceLabel' | 'why'> & { summary: string | null },
  now: Date,
  extraTerms: string[],
): FeedRow {
  const score = scoreHot(
    { provider: partial.provider, title: partial.title, summary: partial.summary, url: partial.url, heat: partial.heat, seenAt: partial.seenAt },
    now,
    { extraTerms },
  );
  return {
    key: partial.key,
    kind: partial.kind,
    refId: partial.refId,
    dailyId: partial.dailyId,
    provider: partial.provider,
    sourceLabel: SOURCE_LABEL[partial.provider] ?? partial.provider,
    title: partial.title,
    why: plain(partial.summary),
    url: partial.url,
    heat: partial.heat,
    heatLabel: heatLabel(partial.provider, partial.heat),
    seenAt: partial.seenAt,
    seenLabel: seenLabel(partial.seenAt, now),
    statusKey: partial.statusKey,
    status: STATUS_LABEL[partial.statusKey],
    fit: fitOf(partial.provider),
    score,
    canAdopt: partial.canAdopt,
  };
}

export async function loadFeedRows(db: PrismaClient, now: Date): Promise<FeedRow[]> {
  const [items, videos, dailies, persona] = await Promise.all([
    db.sourceItem.findMany(),
    db.benchmarkVideo.findMany({ include: { account: { select: { nickname: true } } } }),
    db.dailyTopic.findMany({ select: { id: true, status: true, title: true, why: true, source: true, sourceId: true, day: true } }),
    db.personaProfile.findUnique({ where: { id: 'me' }, select: { pillars: true } }).catch(() => null),
  ]);
  const extraTerms = pillarNames(persona?.pillars);
  const bySource = new Map<string, DailyRef>();
  const byBench = new Map<string, DailyRef>();
  for (const t of dailies) {
    if (t.source === 'source') bySource.set(t.sourceId, t);
    if (t.source === 'benchmark') byBench.set(t.sourceId, t);
  }
  const consumedDaily = new Set<string>();

  const rows: FeedRow[] = items.map((item) => {
    const daily = bySource.get(item.id);
    if (daily) consumedDaily.add(daily.id);
    const statusKey: StatusKey =
      item.status === 'dismissed' ? 'dismissed' : daily?.status === 'adopted' ? 'adopted' : daily?.status === 'new' ? 'draft' : item.status === 'used' ? 'used' : 'fresh';
    return rowFrom(
      {
        key: `source:${item.id}`,
        kind: 'source',
        refId: item.id,
        dailyId: daily?.status === 'new' ? daily.id : null,
        provider: item.provider,
        title: daily?.status === 'new' && daily.title.trim() ? daily.title : item.title,
        summary: daily?.status === 'new' && daily.why.trim() ? daily.why : item.summary,
        url: item.url,
        heat: item.heat,
        seenAt: item.day,
        statusKey,
        canAdopt: daily?.status === 'new',
      },
      now,
      extraTerms,
    );
  });

  for (const v of videos) {
    const daily = byBench.get(v.id);
    if (daily) consumedDaily.add(daily.id);
    const statusKey: StatusKey = v.status === 'ignored' ? 'dismissed' : daily?.status === 'adopted' || v.status === 'adopted' ? 'adopted' : daily?.status === 'new' ? 'draft' : v.status === 'seen' ? 'used' : 'fresh';
    const topic = v.desc.replace(/#\S+/g, '').trim();
    rows.push(
      rowFrom(
        {
          key: `benchmark:${v.id}`,
          kind: 'benchmark',
          refId: v.id,
          dailyId: daily?.status === 'new' ? daily.id : null,
          provider: 'benchmark',
          title: daily?.status === 'new' && daily.title.trim() ? daily.title : topic.slice(0, 80) || v.desc.slice(0, 80),
          summary: daily?.status === 'new' && daily.why.trim() ? daily.why : `${v.account.nickname}：${topic}`.slice(0, 240),
          url: v.url,
          heat: v.ratio,
          seenAt: v.publishedAt.toISOString(),
          statusKey,
          canAdopt: daily?.status === 'new',
        },
        now,
        extraTerms,
      ),
    );
  }

  for (const t of dailies) {
    if (consumedDaily.has(t.id)) continue;
    if (t.status === 'expired') continue;
    const statusKey: StatusKey = t.status === 'dismissed' ? 'dismissed' : t.status === 'adopted' ? 'adopted' : 'draft';
    rows.push(
      rowFrom(
        {
          key: `daily:${t.id}`,
          kind: 'daily',
          refId: t.id,
          dailyId: t.status === 'new' ? t.id : null,
          provider: t.source,
          title: t.title,
          summary: t.why,
          url: null,
          heat: null,
          seenAt: t.day,
          statusKey,
          canAdopt: t.status === 'new',
        },
        now,
        extraTerms,
      ),
    );
  }

  return rows;
}

function ageOf(seenAt: string | null, now: Date): number {
  if (!seenAt) return Number.POSITIVE_INFINITY;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(seenAt);
  const t = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : Date.parse(seenAt);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - t) / 86_400_000;
}

/** 筛选和排序。不截断条数，分页由调用方切。 */
export function rankFeed(rows: FeedRow[], query: FeedQuery, now: Date): FeedRow[] {
  const q = query.q.toLowerCase();
  const ranged = query.range === 'all' ? null : Number(query.range);
  const filtered = rows.filter((r) => {
    if (query.source !== 'all' && r.provider !== query.source) return false;
    if (query.status === 'open' && r.statusKey === 'dismissed') return false;
    else if (query.status !== 'all' && query.status !== 'open' && r.statusKey !== query.status) return false;
    if (ranged != null && ageOf(r.seenAt, now) >= ranged) return false;
    if (q && !`${r.title}\n${r.why ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const cmp = (a: FeedRow, b: FeedRow): number => {
    if (query.sort === 'heat') return (b.heat ?? -1) - (a.heat ?? -1) || b.score.total - a.score.total;
    if (query.sort === 'new') return ageOf(a.seenAt, now) - ageOf(b.seenAt, now) || b.score.total - a.score.total;
    return b.score.total - a.score.total || (b.heat ?? -1) - (a.heat ?? -1);
  };
  return filtered.sort(cmp);
}

export function countByProvider(rows: FeedRow[]): { provider: string; label: string; count: number }[] {
  const order = ['github', 'hackernews', 'x', 'benchmark', 'sequel', 'idea'];
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.provider, (counts.get(r.provider) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]) || b[1] - a[1])
    .map(([provider, count]) => ({ provider, label: SOURCE_LABEL[provider] ?? provider, count }));
}
