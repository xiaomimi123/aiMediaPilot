import type { PrismaClient } from '@prisma/client';
import { listDrafts } from '@/lib/draft/store';
import { listIdeas } from '@/lib/topics/daily';
import { HOME_PIN, loadFeedRows, rankFeed, type FeedRow } from './feed';

export type { FeedRow };

export interface IdeaCard {
  id: string;
  text: string;
  status: string;
  /** 已经开了草稿时，接着写这一篇 */
  draftId: string | null;
}

export interface HomeDesk {
  hot: FeedRow[];
  /** 没被忽略的全部条数。首页只置顶其中的前若干条。 */
  totalHot: number;
  ideas: IdeaCard[];
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

const OPEN = { q: '', source: 'all', range: 'all', status: 'open', sort: 'score', page: 1 };

export async function loadHome(db: PrismaClient, now: Date): Promise<HomeDesk> {
  const [rows, ideas, drafts] = await Promise.all([
    loadFeedRows(db, now).catch(() => []),
    listIdeas(db).catch(() => []),
    listDrafts(db).catch(() => []),
  ]);
  const open = rankFeed(rows, OPEN, now);
  const draftByIdea = new Map(drafts.filter((d) => d.ideaId && d.status !== 'done').map((d) => [d.ideaId as string, d.id]));
  const ideaCards: IdeaCard[] = [];
  for (const idea of ideas) {
    const draftId = draftByIdea.get(idea.id) ?? null;
    if (idea.status === 'fresh') ideaCards.push({ id: idea.id, text: idea.text, status: '待写', draftId: null });
    else if (draftId) ideaCards.push({ id: idea.id, text: idea.text, status: '写到一半', draftId });
  }
  return { hot: open.slice(0, HOME_PIN), totalHot: open.length, ideas: ideaCards };
}
