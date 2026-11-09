import type { PrismaClient } from '@prisma/client';
import { fetchX } from './x';

/**
 * 信息源采集: GitHub(最近爆发的仓库) + Hacker News(热帖) + X(热帖, 用户自建中转仓库), 全收不过滤。
 * 每晚选题把没用的条目当「资讯」来源喂给编导; 抓取只是入库, 不碰模型。
 *
 * 数据源(2026-11-06 真机验证过可达):
 * - GitHub Search API, 无需 key, 搜索限 10 次/分钟 —— 关键词按天轮换, 一天只发 2-4 个请求
 * - HN Algolia API, 无需 key, front_page 一发请求
 * - X: git clone 用户的中转仓库拿 latest.json, 见 ./x.ts
 */

export const LOCAL_SOURCE_PROVIDERS = ['github', 'hackernews', 'x'] as const;
export type SourceProvider = (typeof LOCAL_SOURCE_PROVIDERS)[number];

type Db = Pick<PrismaClient, 'sourceItem'>;

export interface RawItem {
  provider: SourceProvider;
  outerId: string;
  title: string;
  summary: string | null;
  url: string;
  heat: number;
}

const TIMEOUT = 15_000;

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(url, { headers: { 'user-agent': 'MediaPilot/1.0', ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`HTTP ${r.status}：${url.slice(0, 80)}`);
  return (await r.json()) as T;
}

export const localDay = (now: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
};

/** GitHub: 最近 N 天创建、按 star 排序的仓库(需要 star 数同时涨得快, 用 created 近 7 天兜住"新爆发") */
export async function fetchGithub(now: Date): Promise<RawItem[]> {
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString().slice(0, 10);
  // 两个查询覆盖「新爆发」和「AI/agent 常青」; 搜索限额 10 次/分钟, 这里只发 2 个
  const queries = [
    `created:>${since}`,
    `topic:ai-agent created:>${new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10)}`,
  ];
  const out: RawItem[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const d = await getJson<{ items: { full_name: string; html_url: string; description: string | null; stargazers_count: number }[] }>(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`,
    );
    for (const r of d.items ?? []) {
      if (seen.has(r.full_name)) continue;
      seen.add(r.full_name);
      out.push({ provider: 'github', outerId: r.full_name, title: r.full_name, summary: r.description, url: r.html_url, heat: r.stargazers_count });
    }
  }
  return out;
}

/** Hacker News: 首页热帖(即 Algolia 的 front_page) */
export async function fetchHackerNews(): Promise<RawItem[]> {
  const d = await getJson<{ hits: { objectID: string; title: string | null; url: string | null; points: number; story_text: string | null }[] }>(
    'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30',
  );
  return (d.hits ?? [])
    .filter((h) => h.title)
    .map((h) => ({
      provider: 'hackernews' as const,
      outerId: h.objectID,
      title: h.title!,
      summary: h.story_text?.replace(/<[^>]+>/g, '').slice(0, 500) ?? null,
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      heat: h.points ?? 0,
    }));
}

export interface FetchReport {
  saved: number;
  total: number;
  errors: string[];
}

/** 抓全部源并入库存到指定日期; 单源失败不影响其他源 */
export async function fetchAndStore(db: Db, now: Date): Promise<FetchReport> {
  const day = localDay(now);
  const errors: string[] = [];
  let saved = 0;
  let total = 0;
  const batches = await Promise.allSettled([fetchGithub(now), fetchHackerNews(), fetchX(now)]);
  const labels = ['github', 'hackernews', 'x'];
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    if (b.status === 'rejected') {
      errors.push(`${labels[i]}: ${b.reason instanceof Error ? b.reason.message : String(b.reason)}`);
      continue;
    }
    for (const item of b.value) {
      total++;
      // 唯一键冲突 = 抓过, 只刷新热度
      const r = await db.sourceItem.upsert({
        where: { provider_outerId: { provider: item.provider, outerId: item.outerId } },
        create: { ...item, day },
        update: { heat: item.heat },
      });
      if (r.day === day) saved++;
    }
  }
  return { saved, total, errors };
}

/** 近 N 天还没用过的条目, 按热度降序(选题时用) */
export async function freshItems(db: Db, now: Date, days = 3): Promise<{ id: string; title: string; summary: string | null; url: string; heat: number; provider: string; day: string }[]> {
  const cutoff = localDay(new Date(now.getTime() - days * 86400_000));
  return db.sourceItem.findMany({
    where: { status: 'fresh', day: { gte: cutoff } },
    orderBy: [{ heat: 'desc' }],
    take: 40,
  });
}
