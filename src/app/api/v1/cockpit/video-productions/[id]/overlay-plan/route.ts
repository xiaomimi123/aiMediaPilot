import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { OverlayPlanSchema } from '@/lib/video-production/overlay-plan';

/**
 * 剪辑台「文字叠加」PATCH(三十七期 Task 5)——全量替换语义, 机制照抄同目录
 * `film-plan/route.ts` 的 PUT: 归属校验用 404(不裸露资源存在性)、只有
 * `plan_ready` 状态允许写(渲染中/已完成改叠加层没有意义, 且会撕裂状态)、
 * `updateMany` 带 status 条件做乐观并发控制(读写之间状态变化 → 409, 编辑
 * 被无声丢弃比报错糟)。
 *
 * 叫 PATCH 而不是 PUT: 与 `film-plan` 是同一个资源(`videoProduction`)上的
 * 两个不同字段, 用不同 HTTP 方法名对同一路由前缀区分, 避免调用方搞混
 * "改的是分镜方案还是叠加层"。语义仍是整份 `overlayPlan.items` 全量替换,
 * 不是逐条 PATCH——`OverlayPlanSchema` 就几条, 全量替换 + 完整 schema 校验
 * 足够, 不值得为它引入逐条 PATCH 的复杂度(同 `film-plan/route.ts` 顶部
 * 关于"全量替换而非逐镜 PATCH"的理由)。
 */

const PatchBodySchema = z.object({ plan: z.unknown() });

function describeSchemaIssues(plan: unknown): string[] {
  const r = OverlayPlanSchema.safeParse(plan);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const path = i.path.join('.');
    return path ? `${path}: ${i.message}` : i.message;
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }
  const parsedBody = PatchBodySchema.safeParse(body);
  if (!parsedBody.success) return fail('请求体格式不对, 需要 { plan }', 400);

  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);

  if (vp.status !== 'plan_ready') {
    return fail(`这条任务当前是「${vp.status}」, 不是「分镜待确认」, 不能编辑叠加层`, 400);
  }

  const schemaResult = OverlayPlanSchema.safeParse(parsedBody.data.plan);
  if (!schemaResult.success) {
    return fail('叠加层方案格式不对', 400, { errors: describeSchemaIssues(parsedBody.data.plan) });
  }
  const plan = schemaResult.data;

  const written = await prisma.videoProduction.updateMany({
    where: { id: params.id, status: 'plan_ready' },
    data: {
      overlayPlan: plan as unknown as Prisma.InputJsonValue,
      updatedAt: new Date().toISOString(),
    },
  });
  if (written.count === 0) {
    return fail('任务状态刚刚变化(可能切换了渲染器或已开始处理), 请刷新后重试', 409);
  }

  return ok({ id: vp.id, overlayPlan: plan });
}
