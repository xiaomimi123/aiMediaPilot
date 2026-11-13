import type { PrismaClient } from '@prisma/client';
import { readSourcesStatus } from '@/lib/douyin/collect-log';
import { listDrafts } from '@/lib/draft/store';
import { listIdeas } from '@/lib/topics/daily';
import { clusterRows, hiddenByDefault, pickHome, type TopicCluster } from './cluster';
import { loadFeedRows, rankFeed, type FeedRow } from './feed';

export type { FeedRow };

export interface IdeaCard {
  id: string;
  text: string;
  status: string;
  /** 已经开了草稿时，接着写这一篇 */
  draftId: string | null;
}

export interface SourceStat {
  label: string;
  count: number;
  /** 最近一条的抓取日；没有条目就是 null */
  newest: string | null;
}

export interface HomeDesk {
  picks: TopicCluster[];
  /** 没被忽略的全部条数。首页只留其中大约 10 条。 */
  totalHot: number;
  ideas: IdeaCard[];
  sources: SourceStat[];
  /** 抓取日志的一句话。没有日志就直说没有。 */
  fetchLine: string;
}

const SOURCE_ORDER = [
  ['github', 'GitHub'],
  ['hackernews', 'Hacker News'],
  ['x', 'X'],
  ['reddit', 'Reddit'],
] as const;

const dayLabel = (day: string | null, now: Date): string | null => {
  if (!day) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  if (day === today) return '今天';
  return day.slice(5);
};

export async function loadSourceHealth(db: PrismaClient, now: Date): Promise<{ sources: SourceStat[]; fetchLine: string }> {
  const [items, benches, fetch] = await Promise.all([
    db.sourceItem.findMany({ select: { provider: true, day: true } }).catch(() => []),
    db.benchmarkVideo.count().catch(() => 0),
    readSourcesStatus(now).catch(() => null),
  ]);
  const by = new Map<string, { count: number; newest: string | null }>();
  for (const item of items) {
    const cur = by.get(item.provider) ?? { count: 0, newest: null };
    cur.count += 1;
    if (item.day && (cur.newest == null || item.day > cur.newest)) cur.newest = item.day;
    by.set(item.provider, cur);
  }
  const sources: SourceStat[] = SOURCE_ORDER.map(([id, label]) => {
    const g = by.get(id);
    return { label, count: g?.count ?? 0, newest: dayLabel(g?.newest ?? null, now) };
  });
  sources.push({ label: '抖音对标', count: benches, newest: null });
  const fetchLine = !fetch || fetch.state === 'never' ? '没有抓取日志。' : fetch.state === 'ok' ? '最近一次抓取成功。' : fetch.hint;
  return { sources, fetchLine };
}

/** 账号这一行：全空或全 0 时不占首页 */
export function accountLine(m: { fans: number | null; likes: number | null; works: number; views: number }): string | null {
  if (m.fans == null && m.likes == null && m.works === 0) return null;
  const parts: string[] = [];
  if (m.fans != null) parts.push(`粉丝 ${m.fans.toLocaleString('en-US')}`);
  if (m.likes != null) parts.push(`获赞 ${m.likes.toLocaleString('en-US')}`);
  if (m.works > 0) parts.push(`公开 ${m.works} 条，播放 ${m.views.toLocaleString('en-US')}`);
  return parts.join(' · ');
}

const OPEN = { q: '', source: 'all', range: 'all', status: 'open', sort: 'score', page: 1, show: 'curated' } as const;

export async function loadHome(db: PrismaClient, now: Date): Promise<HomeDesk> {
  const [rows, ideas, drafts] = await Promise.all([
    loadFeedRows(db, now).catch(() => []),
    listIdeas(db).catch(() => []),
    listDrafts(db).catch(() => []),
  ]);
  const open = rankFeed(rows, OPEN, now);
  const worth = open.filter((row) => !hiddenByDefault(row));
  const draftByIdea = new Map(drafts.filter((d) => d.ideaId && d.status !== 'done').map((d) => [d.ideaId as string, d.id]));
  const ideaCards: IdeaCard[] = [];
  for (const idea of ideas) {
    const draftId = draftByIdea.get(idea.id) ?? null;
    if (idea.status === 'fresh') ideaCards.push({ id: idea.id, text: idea.text, status: '待写', draftId: null });
    else if (draftId) ideaCards.push({ id: idea.id, text: idea.text, status: '写到一半', draftId });
  }
  const health = await loadSourceHealth(db, now).catch(() => ({ sources: [], fetchLine: '没有抓取日志。' }));
  return { picks: pickHome(clusterRows(worth)), totalHot: open.length, ideas: ideaCards, sources: health.sources, fetchLine: health.fetchLine };
}
