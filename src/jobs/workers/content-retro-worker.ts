import { Worker, type Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';
import { probeDouyinCookie, runDouyinAdapter } from '@/lib/douyin/adapter';
import { parseReportMd } from '@/lib/douyin/report-parser';
import { type IVisionLLM, type TokenUsage } from '@/lib/llm/vision';
import { getDeepSeekTextLLM, getOpenAIVisionLLM } from '@/lib/llm/clients';
import { RETRO_GAP, type RetroGapResponse } from '@/lib/llm/prompts';
import type { RetroStatus } from '@prisma/client';

type JobData = { analysisId: string };

async function setRetroStatus(analysisId: string, status: RetroStatus, extra: Record<string, unknown> = {}) {
  await prisma.contentAnalysis.update({
    where: { id: analysisId },
    data: { retroStatus: status, ...extra },
  });
}

function mergeLlmUsage(existing: unknown, add: TokenUsage): unknown {
  const e = (existing as any) ?? { byCall: [], total: { model: 'aggregate', promptTokens: 0, completionTokens: 0, estCostUSD: 0 } };
  return {
    byCall: [...(e.byCall ?? []), add],
    total: {
      model: 'aggregate',
      promptTokens: (e.total?.promptTokens ?? 0) + add.promptTokens,
      completionTokens: (e.total?.completionTokens ?? 0) + add.completionTokens,
      estCostUSD: (e.total?.estCostUSD ?? 0) + add.estCostUSD,
    },
  };
}

export async function runRetroPipeline(analysisId: string): Promise<void> {
  const analysis = await prisma.contentAnalysis.findUnique({ where: { id: analysisId } });
  if (!analysis || !analysis.douyinAwemeId) return;
  if (analysis.retroStatus === 'CANCELLED') return;

  // 阶段 1: RUNNING + cookie 探测
  await setRetroStatus(analysisId, 'RUNNING', { retroStartedAt: new Date() });
  const cookieOk = await probeDouyinCookie();
  if (!cookieOk) {
    await setRetroStatus(analysisId, 'FAILED', {
      retroErrorMessage: '抖音 cookie 失效,请在 cheat-on-content 项目目录重新扫码登录',
    });
    return;
  }

  // 阶段 2: adapter 拉数据
  let reportPath: string;
  try {
    reportPath = await runDouyinAdapter(analysis.douyinAwemeId);
  } catch (err) {
    await setRetroStatus(analysisId, 'FAILED', {
      retroErrorMessage: `数据采集失败: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // 阶段 3: parse
  const parsed = await parseReportMd(reportPath);

  // 阶段 4: 落 ActualMetric
  const daysAfterPublish = (Date.now() - analysis.publishedAt!.getTime()) / 86400000;
  await prisma.actualMetric.create({
    data: {
      analysisId,
      snapshotAt: new Date(),
      daysAfterPublish,
      plays: parsed.plays,
      likes: parsed.likes,
      comments: parsed.comments,
      shares: parsed.shares,
      collects: parsed.collects,
      likeRateBp: parsed.likeRateBp,
      commentRateBp: parsed.commentRateBp,
      shareRateBp: parsed.shareRateBp,
      completionRateBp: parsed.completionRateBp,
      retention3sBp: parsed.retention3sBp,
      followConversionBp: parsed.followConversionBp,
      topComments: (parsed.topComments ?? Prisma.JsonNull) as any,
      rawReportPath: reportPath,
    },
  });

  // 阶段 5: AI 落差总结 (fail-soft)
  let retroReport: RetroGapResponse | null = null;
  let llmUsageDelta: TokenUsage | null = null;
  try {
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const llm: IVisionLLM = deepseekKey
      ? getDeepSeekTextLLM(deepseekKey)
      : getOpenAIVisionLLM({
          apiKey: process.env.OPENAI_API_KEY!,
          baseURL: process.env.OPENAI_BASE_URL || undefined,
          defaultModel: process.env.OPENAI_SYNTHESIZE_MODEL || 'gpt-4o-mini',
        });
    const out = await llm.callStructured({
      systemPrompt: RETRO_GAP.buildSystemPrompt(analysis.niche || 'ai-knowledge'),
      userMessage: RETRO_GAP.buildUserMessage({
        report: analysis.report as any,
        actual: parsed,
      }),
      responseSchema: RETRO_GAP.responseSchema,
    });
    retroReport = out.result;
    llmUsageDelta = out.usage;
  } catch (err) {
    console.error('[content-retro-worker] AI gap analysis failed:', err);
  }

  // 阶段 6: 落最终 (cancel race 保护 + llmUsage 累加)
  const newLlmUsage = llmUsageDelta ? mergeLlmUsage(analysis.llmUsage, llmUsageDelta) : analysis.llmUsage;
  await prisma.contentAnalysis.updateMany({
    where: { id: analysisId, retroStatus: { not: 'CANCELLED' } },
    data: {
      retroStatus: 'COMPLETED',
      retroCompletedAt: new Date(),
      retroReport: (retroReport ?? Prisma.JsonNull) as any,
      llmUsage: newLlmUsage as any,
    },
  });
}

async function handleRetro(job: Job<JobData>) {
  await runRetroPipeline(job.data.analysisId);
}

export function startContentRetroWorker() {
  const worker = new Worker<JobData>(QUEUES.RETRO, handleRetro, { connection: redis });
  worker.on('failed', (job, err) => {
    console.error('[content-retro-worker] failed', job?.id, err);
    if (job) {
      prisma.contentAnalysis
        .update({
          where: { id: job.data.analysisId },
          data: { retroStatus: 'FAILED', retroErrorMessage: err.message, retroCompletedAt: new Date() },
        })
        .catch(() => {});
    }
  });
  worker.on('completed', (job) => {
    console.log('[content-retro-worker] completed', job.id);
  });
  return worker;
}
