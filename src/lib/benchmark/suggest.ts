import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { StructuredLLM } from '@/lib/script/write';
import { AnalysisSchema } from './analyze';
import type { BenchmarkStore } from './store';

export const SUGGEST_DAYS = 14;
export const MIN_HITS = 2;

export interface TopicSuggestion {
  topic: string;
  why: string;
  hook: string;
  sources: { id: string; author: string; ratio: number | null; desc: string }[];
}

const OutSchema = z.object({
  topics: z.array(z.object({ topic: z.string().min(1), why: z.string().min(1), hook: z.string().min(1), sourceVideoIds: z.array(z.string()).min(1) })).min(1).max(3),
});

const SYSTEM_PROMPT = `你是抖音 AI 知识类博主的编导，从最近的对标爆款里给博主挑 3 个能做的选题。
- 只能基于给你的对标爆款（每条有编号）；每个选题的 sourceVideoIds 填它参考的爆款编号，必须来自输入。
- 不编造"最近很火的XX"这类输入里没有的热点，不编数字。
- why：为什么适合这个博主（对上了定位里哪个内容支柱或痛点；可参考博主自己跑得好的作品）。
- hook：建议的开头钩子（一句话，借写法，不照抄对标原话）。
- 避开博主定位里的忌讳。
只输出 JSON：{"topics": [{"topic": "", "why": "", "hook": "", "sourceVideoIds": [""]}]}`;

export async function suggestTopics(opts: {
  store: BenchmarkStore;
  llm: StructuredLLM;
  personaText: string;
  myTopTitles: string[];
  now: Date;
}): Promise<{ ok: true; topics: TopicSuggestion[] } | { ok: false; reason: string }> {
  const hits = await opts.store.listVideos({ isHit: true, statusNot: ['ignored'], publishedSince: new Date(opts.now.getTime() - SUGGEST_DAYS * 86400_000) });
  if (hits.length < MIN_HITS) {
    return { ok: false, reason: `近 ${SUGGEST_DAYS} 天对标里只有 ${hits.length} 条爆款，数据太少挑不出靠谱的选题。先在「选题」页多关注几个对标账号，等巡检跑几晚再来。` };
  }
  const authors = new Map<string, string>();
  for (const h of hits) {
    if (!authors.has(h.accountId)) authors.set(h.accountId, (await opts.store.getAccount(h.accountId))?.nickname ?? '');
  }
  const list = hits
    .map((h) => {
      const a = AnalysisSchema.safeParse(h.analysis);
      const detail = a.success ? `选题：${a.data.topic}｜钩子（${a.data.hook.type}）：${a.data.hook.quote}` : `文案：${h.desc.slice(0, 80)}`;
      return `[${h.id}] ${authors.get(h.accountId)}｜平时的 ${h.ratio ?? '?'} 倍｜${detail}`;
    })
    .join('\n');
  const { result } = await opts.llm.callStructured({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: [
      {
        type: 'text',
        text: `【博主定位】\n${opts.personaText || '（未填写）'}\n\n【博主自己跑得好的作品】\n${opts.myTopTitles.join('\n') || '（暂无）'}\n\n【近 ${SUGGEST_DAYS} 天对标爆款】\n${list}`,
      },
    ],
    responseSchema: OutSchema,
  });
  const byId = new Map(hits.map((h) => [h.id, h]));
  const topics = result.topics
    .map((t) => ({
      topic: t.topic,
      why: t.why,
      hook: t.hook,
      sources: t.sourceVideoIds.filter((id) => byId.has(id)).map((id) => {
        const h = byId.get(id)!;
        return { id, author: authors.get(h.accountId) ?? '', ratio: h.ratio, desc: h.desc };
      }),
    }))
    .filter((t) => t.sources.length > 0);
  if (topics.length === 0) return { ok: false, reason: '这次编导给的选题都对不上已有的对标作品，已丢弃。再点一次试试。' };
  return { ok: true, topics };
}

export async function loadMyTopTitles(db: PrismaClient): Promise<string[]> {
  const rows = await db.publishedWork.findMany({ where: { isPrivate: false }, orderBy: { digg: 'desc' }, take: 5, select: { title: true } });
  return rows.map((r) => r.title);
}
