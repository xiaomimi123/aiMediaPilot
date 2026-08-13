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
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
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
  /** 'fatal' = 管线中途抛出未捕获异常; 'budget' = 24h 滚动额度已用完。均无 keyword/url。 */
  stage?: 'fatal' | 'budget';
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
 * 同样地, DeepSeek key 缺失 (设置卡 AIConfig 与 `.env` 均未配置, 见
 * `resolveDeepSeekApiKey`) 时也没法评估任何一篇, 同样返回 null
 * (brief 未明确这个分支, 但语义上与"没有可用 key"一致, 不单独创建一条全错的 Run)。
 */
export async function runRadarScan(userId: string): Promise<RadarRunStats | null> {
  const config = await getRadarConfig(userId);
  if (!config.enabled) return null;

  const tavilyKey = await getDecryptedTavilyKey(userId);
  if (!tavilyKey) return null;

  const deepseekKey = await resolveDeepSeekApiKey(userId);
  if (!deepseekKey) {
    console.error('[radar/run] DEEPSEEK_API_KEY 未配置 (AIConfig 与 .env 均无), 跳过本轮扫描');
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

  // R2/R3 终审修复: `searched`/`read`/`kept`/`errors` 提到函数体这一级 (而非嵌在
  // try 块局部), 这样无论正常收尾还是异常收尾, `finalize()` 都能拿到"现值"——
  // 异常发生前已经跑完的搜索/阅读进度不会因为兜底收尾而丢失或清零。
  const errors: RadarRunError[] = [];
  let searched = 0;
  let read = 0;
  let kept = 0;

  // R2 终审修复: 单一收尾出口 —— 正常路径、预算耗尽早停路径、异常兜底路径
  // 三处都调它, 避免出现"正常路径已经 update 过一次, catch 里又 update 一次"
  // 的重复写, 也避免漏掉任何一条路径忘记 finalize。
  const finalize = () =>
    prisma.radarRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), searched, read, kept, errors: errors as any },
    });

  try {
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

    // R3 终审修复: dailyLimit 必须是「近 24 小时累计已读」的滚动预算, 而不是
    // "这一轮最多读多少"——否则用户在同一天内多次点「立即扫描」, 每次都能各读
    // 满 dailyLimit 篇, 实际累计阅读量随点击次数线性增长, 形同虚设。
    // 含本条刚创建的 run 一起 sum (它 read 默认 0, 不影响结果), 不必特意排除。
    const spentAgg = await prisma.radarRun.aggregate({
      _sum: { read: true },
      where: { userId, startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    const spent = spentAgg._sum.read ?? 0;
    const effectiveBudget = Math.max(0, config.dailyLimit - spent);

    if (effectiveBudget === 0) {
      // 预算耗尽是用户可见的正常结局 (不是错误), 但仍要给出一条 errors 记录
      // 解释"为什么这轮读了 0 篇"——否则用户只会看到一条空转的运行摘要。
      errors.push({ stage: 'budget', message: '今日阅读额度已用完' });
      await finalize();
      return { runId: run.id, searched, read, kept, errors };
    }

    // 阅读评分: 读满 effectiveBudget 即停; 单篇失败记 errors 后继续下一篇;
    // relevance < 40 判为不相关, 丢弃 (不入库), 计入 read 但不计入 kept。
    const keptItems: KeptItem[] = [];
    const suggestedKeywordsAll = new Set<string>();

    for (const cand of collected) {
      if (read >= effectiveBudget) break;
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

    kept = radarItemsData.length;

    await finalize();
    return { runId: run.id, searched, read, kept, errors };
  } catch (err) {
    // R2 终审修复: 此前中途抛出的任何未捕获异常 (如 `$transaction` 失败) 都会让
    // 这条 RadarRun 永远停在 `finishedAt: null`——雷达视图「上轮运行摘要」会一直
    // 显示这条本质上已经死掉的运行, 且下一轮跑之前的进度对用户完全不可见。
    // 这里 best-effort 兜底收尾 (带上异常发生前已经累积的 searched/read/kept),
    // 再原样 rethrow —— worker 的 catch 会记日志, job 语义不变。
    errors.push({ stage: 'fatal', message: err instanceof Error ? err.message : String(err) });
    try {
      await finalize();
    } catch (finalizeErr) {
      console.error('[radar/run] 兜底收尾也失败', finalizeErr);
    }
    throw err;
  }
}
