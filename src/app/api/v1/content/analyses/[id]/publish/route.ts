import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { resolveDouyinUrl } from '@/lib/douyin/aweme';
import { retroQueue } from '@/jobs/queue';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => null)) as { url?: string; publishedAt?: string } | null;
  if (!body?.url || !body?.publishedAt) return fail('url 和 publishedAt 必填', 400);

  const publishedAt = new Date(body.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) return fail('publishedAt 格式错误', 400);
  if (publishedAt.getTime() > Date.now()) return fail('发布时间不能在未来', 400);

  const analysis = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!analysis) return fail('not found', 404);
  if (analysis.retroStatus === 'RUNNING') return fail('复盘正在进行中,请先取消', 400);

  const awemeId = await resolveDouyinUrl(body.url);
  if (!awemeId) return fail('无法解析抖音视频 ID,请用完整链接', 400);

  // 软查重: 同 awemeId 不可关联其他 analysis
  const conflict = await prisma.contentAnalysis.findFirst({
    where: { douyinAwemeId: awemeId, NOT: { id: params.id } },
    select: { id: true },
  });
  if (conflict) return fail(`该视频已关联到分析 ${conflict.id}`, 400);

  // 重置 retro 子状态
  await prisma.actualMetric.deleteMany({ where: { analysisId: params.id } });
  await prisma.contentAnalysis.update({
    where: { id: params.id },
    data: {
      douyinUrl: body.url,
      douyinAwemeId: awemeId,
      publishedAt,
      retroStatus: 'SCHEDULED',
      retroReport: Prisma.JsonNull,
      retroErrorMessage: null,
      retroStartedAt: null,
      retroCompletedAt: null,
    },
  });

  const delayMs = Math.max(0, publishedAt.getTime() + 3 * 86400000 - Date.now());
  await retroQueue.add(
    'retro',
    { analysisId: params.id },
    { delay: delayMs, jobId: `retro-${params.id}-${Date.now()}`, removeOnComplete: true, removeOnFail: { age: 7 * 86400, count: 100 } }
  );

  return ok({ scheduledAt: new Date(publishedAt.getTime() + 3 * 86400000).toISOString() });
}
