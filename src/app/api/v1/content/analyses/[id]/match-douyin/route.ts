import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { retroQueue } from '@/jobs/queue';

const AWEME_RE = /^\d{8,30}$/;

function parseLooseTime(input: string): Date | null {
  if (!input) return null;
  const iso = input.replace(' ', 'T') + ':00';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: { awemeId?: unknown; postedAt?: unknown; plays?: unknown; desc?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const awemeId = typeof body.awemeId === 'string' ? body.awemeId.trim() : '';
  if (!AWEME_RE.test(awemeId)) {
    return fail('awemeId 必须是 8-30 位数字', 400);
  }

  const user = await getOrCreateDefaultUser();
  const analysis = await prisma.contentAnalysis.findUnique({
    where: { id },
    select: { id: true, userId: true, douyinAwemeId: true },
  });
  if (!analysis || analysis.userId !== user.id) {
    return fail('分析不存在', 404);
  }
  if (analysis.douyinAwemeId) {
    return fail('该分析已匹配过抖音视频', 409);
  }

  const existing = await prisma.contentAnalysis.findFirst({
    where: { userId: user.id, douyinAwemeId: awemeId },
    select: { id: true },
  });
  if (existing) {
    return fail(`该抖音视频已被另一分析匹配: ${existing.id}`, 409);
  }

  const postedAt = typeof body.postedAt === 'string' ? body.postedAt : '';
  const publishedAt = parseLooseTime(postedAt) ?? new Date();

  try {
    await prisma.contentAnalysis.update({
      where: { id },
      data: {
        douyinAwemeId: awemeId,
        douyinUrl: `https://www.douyin.com/video/${awemeId}`,
        publishedAt,
        retroStatus: 'SCHEDULED',
      },
    });
    await retroQueue.add(
      'retro',
      { analysisId: id },
      { jobId: `retro-${id}`, delay: 0, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600, count: 100 } },
    );
    return ok({ retroEnqueued: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST match-douyin]', e);
    return fail(`匹配失败: ${msg}`, 500);
  }
}
