import { median } from '@/lib/benchmark/rules';
export { localDay } from '@/lib/retro/metrics-store';

export type TopicSource = 'benchmark' | 'sequel' | 'idea';
export const SOURCES: TopicSource[] = ['benchmark', 'sequel', 'idea'];

export interface Candidate {
  source: TopicSource;
  sourceId: string;
  /** 给定选题用的材料: 对标的选题/文案、续集的标题与片尾、点子原话 */
  material: string;
  /** 对标原文(写稿时作参考、做照抄检查) */
  reference?: string;
  benchmarkVideoId?: string;
}

export interface CandidateStore {
  /** 出过选题的 `${source}:${sourceId}` */
  usedKeys(): Promise<Set<string>>;
  benchmarkHits(since: Date): Promise<{ id: string; ratio: number | null; author: string; topic: string | null; desc: string; transcript: string | null }[]>;
  /** 已关联发布作品的项目: 片尾一段(定稿或转写的最后一段) + 播放 */
  ownWorks(): Promise<{ projectId: string; title: string; lastText: string | null; play: number }[]>;
  freshIdeas(): Promise<{ id: string; text: string; createdAt: Date }[]>;
}

export const BENCHMARK_DAYS = 14;
export const SEQUEL_HOOK = /下期|下一期|单独(来)?讲|下次|后面再说|留着/;

export async function loadPools(store: CandidateStore, now: Date): Promise<Record<TopicSource, Candidate[]>> {
  const used = await store.usedKeys();
  const fresh = (source: TopicSource, id: string) => !used.has(`${source}:${id}`);

  const hits = (await store.benchmarkHits(new Date(now.getTime() - BENCHMARK_DAYS * 86400_000)))
    .filter((h) => fresh('benchmark', h.id))
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  const benchmark = hits.map((h) => ({
    source: 'benchmark' as const,
    sourceId: h.id,
    material: `对标作品（${h.author}，平时的 ${h.ratio ?? '?'} 倍）：${h.topic ?? h.desc.replace(/#\S+/g, '').trim().slice(0, 80)}`,
    reference: h.transcript ?? undefined,
    benchmarkVideoId: h.id,
  }));

  const all = await store.ownWorks();
  // 播放中位数按近期全部作品算(不随续集用掉而变低)
  const mid = median(all.map((w) => w.play));
  const works = all.filter((w) => w.lastText && fresh('sequel', w.projectId));
  const sequel = works
    .map((w) => ({ w, hook: SEQUEL_HOOK.test(w.lastText!), strong: mid > 0 && w.play >= mid * 2 }))
    .filter((x) => x.hook || x.strong)
    .sort((a, b) => Number(b.hook) - Number(a.hook) || b.w.play - a.w.play)
    .map(({ w }) => ({ source: 'sequel' as const, sourceId: w.projectId, material: `自己的作品《${w.title}》（播放 ${w.play}）的续集。原片结尾：${w.lastText}` }));

  const idea = (await store.freshIdeas())
    .filter((i) => fresh('idea', i.id))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((i) => ({ source: 'idea' as const, sourceId: i.id, material: i.text }));

  return { benchmark, sequel, idea };
}

/** 先各来源取 1 个, 再按来源顺序轮流补, 最多 max 个 */
export function pickCandidates(pools: Record<TopicSource, Candidate[]>, max = 3): Candidate[] {
  const queues = SOURCES.map((s) => [...pools[s]]);
  const out: Candidate[] = [];
  while (out.length < max && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (out.length >= max) break;
      const next = q.shift();
      if (next) out.push(next);
    }
  }
  return out;
}
