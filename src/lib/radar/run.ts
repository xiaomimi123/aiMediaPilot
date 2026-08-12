import { prisma } from '@/lib/prisma';
import { getRadarConfig, getDecryptedTavilyKey } from './config';
import { getSearchProvider, type SearchResult } from './search';
import {
  titleFingerprint,
  clusterByTopic,
  composeHeat,
  type ClusterableItem,
} from './scoring';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { RADAR_READ, type RadarReadResponse } from '@/lib/llm/prompts/radar-read';

/**
 * 热点雷达 — 采集管线主体 (worker 与手动触发路由共用)。
 *
 * 独立成 lib 函数 (而非直接写在 worker handler 里): 便于 `POST /radar/trigger`
 * 未来如果想同步跑一次 (而不仅仅是入队) 时复用, 也便于单测不依赖 BullMQ/Worker。
 */

const SEARCH_MAX_RESULTS = 8;
const SEARCH_DAYS = 7;
const RELEVANCE_GATE = 40;

export interface RadarRunError {
  keyword?: string;
  url?: string;
  message: string;
}

export interface RadarRunStats {
  runId: string;
  searched: number;
  read: number;
  kept: number;
  errors: RadarRunError[];
}

interface Candidate {
  result: SearchResult;
  matchedKeywords: string[];
}

interface KeptItem {
  result: SearchResult;
  matchedKeywords: string[];
  fingerprint: string;
  readOut: RadarReadResponse;
}

interface ClusterInput extends ClusterableItem {
  item: KeptItem;
}

/**
 * 跑一轮采集。
 *
 * 决定 (brief 明确): `enabled=false` 或未配置 Tavily key 时**不创建 RadarRun**,
 * 直接返回 null — 不是"运行了但立刻结束"的状态, 而是"这一轮压根没跑"。
 * 同样地, 全局 DEEPSEEK_API_KEY 缺失时也没法评估任何一篇, 同样返回 null
 * (brief 未明确这个分支, 但语义上与"没有可用 key"一致, 不单独创建一条全错的 Run)。
 */
export async function runRadarScan(userId: string): Promise<RadarRunStats | null> {
  const config = await getRadarConfig(userId);
  if (!config.enabled) return null;

  const tavilyKey = await getDecryptedTavilyKey(userId);
  if (!tavilyKey) return null;

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (!deepseekKey) {
    console.error('[radar/run] DEEPSEEK_API_KEY 未配置, 跳过本轮扫描');
    return null;
  }

  const keywords = await prisma.radarKeyword.findMany({
    where: { userId, status: 'active' },
  });

  const run = await prisma.radarRun.create({
    data: {
      userId,
      keywordsUsed: keywords.map((k) => k.text),
    },
  });

  const errors: RadarRunError[] = [];
  const searchProvider = getSearchProvider(tavilyKey);
  const llm = getDeepSeekTextLLM(deepseekKey);

  // 对库去重的基线: 已存在的 URL (唯一约束同义) 与标题指纹。
  const existingItems = await prisma.radarItem.findMany({
    where: { userId },
    select: { url: true, titleHash: true },
  });
  const existingUrls = new Set(existingItems.map((i) => i.url));
  const existingFingerprints = new Set(existingItems.map((i) => i.titleHash));

  const collected: Candidate[] = [];
  const seenUrlsThisBatch = new Set<string>();
  const seenFingerprintsThisBatch = new Set<string>();
  let searched = 0;

  for (const kw of keywords) {
    let results: SearchResult[];
    try {
      results = await searchProvider.search(kw.text, {
        maxResults: SEARCH_MAX_RESULTS,
        days: SEARCH_DAYS,
      });
    } catch (e) {
      errors.push({ keyword: kw.text, message: e instanceof Error ? e.message : String(e) });
      continue;
    }
    searched += results.length;

    for (const r of results) {
      if (existingUrls.has(r.url) || seenUrlsThisBatch.has(r.url)) continue;
      const fp = titleFingerprint(r.title);
      if (existingFingerprints.has(fp) || seenFingerprintsThisBatch.has(fp)) continue;
      seenUrlsThisBatch.add(r.url);
      seenFingerprintsThisBatch.add(fp);
      collected.push({ result: r, matchedKeywords: [kw.text] });
    }
  }

  // 阅读评分: 读满 dailyLimit 即停; 单篇失败记 errors 后继续下一篇;
  // relevance < 40 判为不相关, 丢弃 (不入库), 计入 read 但不计入 kept。
  const dailyLimit = config.dailyLimit;
  let read = 0;
  const keptItems: KeptItem[] = [];
  const suggestedKeywordsAll = new Set<string>();

  for (const cand of collected) {
    if (read >= dailyLimit) break;
    read += 1;

    let readOut: RadarReadResponse;
    try {
      const out = await llm.callStructured({
        systemPrompt: RADAR_READ.buildSystemPrompt(),
        userMessage: RADAR_READ.buildUserMessage({
          title: cand.result.title,
          content: cand.result.content,
          sourceSite: cand.result.sourceSite,
          matchedKeywords: cand.matchedKeywords,
        }),
        responseSchema: RADAR_READ.responseSchema,
      });
      readOut = out.result;
    } catch (e) {
      errors.push({ url: cand.result.url, message: e instanceof Error ? e.message : String(e) });
      continue;
    }

    if (readOut.relevance < RELEVANCE_GATE) continue;

    for (const kw of readOut.suggestedKeywords) suggestedKeywordsAll.add(kw);
    keptItems.push({
      result: cand.result,
      matchedKeywords: cand.matchedKeywords,
      fingerprint: titleFingerprint(cand.result.title),
      readOut,
    });
  }

  // 聚簇 + 共现加成: 同簇内不同来源站点数 - 1 (自身不算)。
  const clusterInputs: ClusterInput[] = keptItems.map((item) => ({
    titleFingerprint: item.fingerprint,
    matchedKeywords: item.matchedKeywords,
    item,
  }));
  const clusters = clusterByTopic(clusterInputs);

  const heatByItem = new Map<KeptItem, { heatScore: number; cooccurrenceSources: number }>();
  for (const cluster of clusters) {
    const sourceSites = new Set(cluster.map((c) => c.item.result.sourceSite));
    const cooccurrenceSources = Math.max(0, sourceSites.size - 1);
    for (const c of cluster) {
      const { relevance, freshness, discussion, feasibility } = c.item.readOut;
      const heatScore = composeHeat(
        { relevance, freshness, discussion, feasibility },
        cooccurrenceSources
      );
      heatByItem.set(c.item, { heatScore, cooccurrenceSources });
    }
  }

  const radarItemsData = keptItems.map((item) => {
    const heat = heatByItem.get(item)!;
    let publishedAt: Date | null = null;
    if (item.result.publishedAt) {
      const parsed = new Date(item.result.publishedAt);
      if (!Number.isNaN(parsed.getTime())) publishedAt = parsed;
    }
    return {
      userId,
      url: item.result.url,
      titleHash: item.fingerprint,
      title: item.result.title,
      sourceSite: item.result.sourceSite,
      publishedAt,
      matchedKeywords: item.matchedKeywords,
      aiSummary: item.readOut.summary,
      aiAngle: item.readOut.angle,
      heatScore: heat.heatScore,
      heatFactors: {
        relevance: item.readOut.relevance,
        freshness: item.readOut.freshness,
        discussion: item.readOut.discussion,
        feasibility: item.readOut.feasibility,
        cooccurrenceSources: heat.cooccurrenceSources,
      },
      status: 'new',
      runId: run.id,
    };
  });

  await prisma.$transaction(async (tx) => {
    if (radarItemsData.length > 0) {
      await tx.radarItem.createMany({ data: radarItemsData, skipDuplicates: true });
    }
    if (suggestedKeywordsAll.size > 0) {
      const existingKeywords = await tx.radarKeyword.findMany({
        where: { userId },
        select: { text: true },
      });
      const existingKeywordTexts = new Set(existingKeywords.map((k) => k.text));
      const newKeywordTexts = [...suggestedKeywordsAll].filter(
        (text) => !existingKeywordTexts.has(text)
      );
      if (newKeywordTexts.length > 0) {
        await tx.radarKeyword.createMany({
          data: newKeywordTexts.map((text) => ({
            userId,
            text,
            status: 'candidate',
            source: 'ai',
          })),
          skipDuplicates: true,
        });
      }
    }
  });

  const kept = radarItemsData.length;

  await prisma.radarRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      searched,
      read,
      kept,
      errors: errors as any,
    },
  });

  return { runId: run.id, searched, read, kept, errors };
}
