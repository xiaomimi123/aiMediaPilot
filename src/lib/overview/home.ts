import type { PrismaClient } from '@prisma/client';
import { listDrafts } from '@/lib/draft/store';
import { freshItems } from '@/lib/sources/fetch';
import { listDaily, listIdeas } from '@/lib/topics/daily';

/** 这条流水线实际会出的成片。没有按条目另存「适合哪些平台」，这里只按来源区分。 */
const FIT_DOUYIN = '适合抖音口播';
const FIT_GITHUB = '适合抖音口播，录操作时用横版';

const PROVIDER_NAME: Record<string, string> = {
  github: 'GitHub',
  hackernews: 'Hacker News',
  x: 'X',
};

export interface HotCard {
  id: string;
  kind: 'daily' | 'source';
  title: string;
  /** 来源名，如 GitHub、抖音对标 */
  source: string;
  /** 已有的热度，没有就不显示 */
  heat: string | null;
  /** 每日选题的 why，或信息源自带的简介。没有就不显示 */
  why: string | null;
  fit: string;
  status: string;
  url: string | null;
}

export interface IdeaCard {
  id: string;
  text: string;
  status: string;
  /** 已经开了草稿时，接着写这一篇 */
  draftId: string | null;
}

export interface HomeDesk {
  hot: HotCard[];
  /** 热点多于首页能放下的条数 */
  moreHot: number;
  ideas: IdeaCard[];
}

const heatOf = (provider: string, heat: number): string => {
  const n = heat.toLocaleString('en-US');
  if (provider === 'github') return `${n} stars`;
  if (provider === 'hackernews') return `${n} points`;
  if (provider === 'x') return `${n} 浏览`;
  return n;
};

const fitOf = (provider: string | null): string => (provider === 'github' ? FIT_GITHUB : FIT_DOUYIN);

/** 账号这一行：全空或全 0 时不占首页 */
export function accountLine(m: { fans: number | null; likes: number | null; works: number; views: number }): string | null {
  if (m.fans == null && m.likes == null && m.works === 0) return null;
  const parts: string[] = [];
  if (m.fans != null) parts.push(`粉丝 ${m.fans.toLocaleString('en-US')}`);
  if (m.likes != null) parts.push(`获赞 ${m.likes.toLocaleString('en-US')}`);
  if (m.works > 0) parts.push(`公开 ${m.works} 条，播放 ${m.views.toLocaleString('en-US')}`);
  return parts.join(' · ');
}

const HOT_LIMIT = 8;

export async function loadHome(db: PrismaClient, now: Date): Promise<HomeDesk> {
  const [daily, items, ideas, drafts] = await Promise.all([
    listDaily(db, now).catch(() => ({ topics: [], lastRun: null })),
    freshItems(db, now, 3).catch(() => []),
    listIdeas(db).catch(() => []),
    listDrafts(db).catch(() => []),
  ]);

  const sourceIds = daily.topics.filter((t) => t.source === 'source').map((t) => t.sourceId);
  const benchIds = daily.topics.filter((t) => t.source === 'benchmark').map((t) => t.sourceId);
  const [linked, benches] = await Promise.all([
    sourceIds.length ? db.sourceItem.findMany({ where: { id: { in: sourceIds } } }) : Promise.resolve([]),
    benchIds.length ? db.benchmarkVideo.findMany({ where: { id: { in: benchIds } }, select: { id: true, ratio: true } }) : Promise.resolve([]),
  ]);
  const linkedById = new Map(linked.map((s) => [s.id, s]));
  const ratioById = new Map(benches.map((b) => [b.id, b.ratio]));
  const consumed = new Set(sourceIds);

  const fromDaily: HotCard[] = daily.topics.map((t) => {
    const item = t.source === 'source' ? linkedById.get(t.sourceId) : undefined;
    const provider = item?.provider ?? null;
    const ratio = t.source === 'benchmark' ? ratioById.get(t.sourceId) : null;
    const source =
      t.source === 'benchmark' ? '抖音对标' : t.source === 'sequel' ? '续集' : t.source === 'idea' ? '点子' : (PROVIDER_NAME[provider ?? ''] ?? t.sourceLabel);
    const heat = item ? heatOf(item.provider, item.heat) : ratio != null ? `平时的 ${ratio} 倍` : null;
    return {
      id: t.id,
      kind: 'daily',
      title: t.title,
      source,
      heat,
      why: t.why.trim() || null,
      fit: fitOf(provider),
      status: t.answered ? '按你的话写过' : '有初稿',
      url: item?.url ?? null,
    };
  });

  const fromSource: HotCard[] = items
    .filter((i) => !consumed.has(i.id))
    .map((i) => ({
      id: i.id,
      kind: 'source' as const,
      title: i.title,
      source: PROVIDER_NAME[i.provider] ?? i.provider,
      heat: heatOf(i.provider, i.heat),
      why: i.summary?.trim() || null,
      fit: fitOf(i.provider),
      status: '还没写',
      url: i.url,
    }));

  const hotAll = [...fromDaily, ...fromSource];
  const draftByIdea = new Map(drafts.filter((d) => d.ideaId && d.status !== 'done').map((d) => [d.ideaId as string, d.id]));
  const ideaCards: IdeaCard[] = [];
  for (const idea of ideas) {
    const draftId = draftByIdea.get(idea.id) ?? null;
    if (idea.status === 'fresh') ideaCards.push({ id: idea.id, text: idea.text, status: '待写', draftId: null });
    else if (draftId) ideaCards.push({ id: idea.id, text: idea.text, status: '写到一半', draftId });
  }

  return { hot: hotAll.slice(0, HOT_LIMIT), moreHot: Math.max(0, hotAll.length - HOT_LIMIT), ideas: ideaCards };
}
