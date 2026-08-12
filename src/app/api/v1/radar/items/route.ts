import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { applyTimeDecay } from '@/lib/radar/scoring';

const STATUSES = ['new', 'adopted', 'ignored'] as const;

/**
 * 雷达条目列表 — 默认只看 status=new (待处理), 按 heatScore 降序。
 *
 * keyword 过滤：matchedKeywords 是 Json 数组 (见 run.ts 写入时 `[kw.text]`)。
 * 这里选择"取回后内存过滤"而非 Prisma 的 `array_contains` —— 单用户单次列表量级
 * 很小 (雷达条目按 dailyLimit 控制在几十条/天), 内存过滤足够快，且不必依赖
 * Postgres JSON 操作符在 Prisma 各版本间的行为差异，是更简单也更容易验证正确的实现。
 *
 * displayScore：纯展示层时间衰减 (applyTimeDecay), 不回写库内 heatScore —— 每次
 * 请求以当前时间重新计算，heatScore 本身保持原始值供审计/排序基线使用。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'new';
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return fail('status 不合法', 400);
  const keyword = url.searchParams.get('keyword') ?? '';

  const user = await getOrCreateDefaultUser();
  const rows = await prisma.radarItem.findMany({
    where: { userId: user.id, status },
    orderBy: { heatScore: 'desc' },
  });

  const now = new Date();
  const filtered = keyword
    ? rows.filter((r) => (r.matchedKeywords as string[]).includes(keyword))
    : rows;

  const items = filtered.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title,
    sourceSite: r.sourceSite,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    collectedAt: r.collectedAt.toISOString(),
    matchedKeywords: r.matchedKeywords as string[],
    aiSummary: r.aiSummary,
    aiAngle: r.aiAngle,
    heatScore: r.heatScore,
    displayScore: applyTimeDecay(r.heatScore, r.collectedAt, now),
    heatFactors: r.heatFactors,
    status: r.status,
    inspirationId: r.inspirationId,
    runId: r.runId,
  }));

  return ok({ items });
}
