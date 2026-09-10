import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

/**
 * 三十八期 Task 2: 单天操作接口 —— 一个路由三种动作, body 里 `action` 判别。
 *
 * - `edit`: 手动改 topic/angle/hookDirection 任意一个或多个, 打 `edited: true`。
 *   仅 status='pending' 允许 —— scripted/produced 之后选题已经被脚本/成片固化,
 *   这时候悄悄改字段会让「规划里写的」和「已经拍出来的」对不上, 409 拒绝并说明去路。
 * - `mark-scripted`: 写稿成功后回填 `scriptDraftId` + status='scripted'。
 *   只认 pending→scripted 方向; 校验该 ScriptDraft 存在且归属本用户(防止把别人的
 *   稿子 ID 挂到自己规划上)。同一份稿子重复调用视为幂等, 直接 200 不动。
 * - `mark-produced`: 出片成功后回填 `videoProductionId` + status='produced'。
 *   只认 scripted→produced 方向, 同理校验归属与幂等。
 */

type LoadOwnedDayResult =
  | { ok: false; error: Response }
  | { ok: true; plan: NonNullable<Awaited<ReturnType<typeof prisma.contentPlan.findUnique>>>; day: NonNullable<Awaited<ReturnType<typeof prisma.contentPlanDay.findUnique>>> };

async function loadOwnedDay(userId: string, planId: string, dayIndexRaw: string): Promise<LoadOwnedDayResult> {
  const dayIndex = Number(dayIndexRaw);
  if (!Number.isInteger(dayIndex)) {
    return { ok: false, error: fail('dayIndex 必须是整数', 400) };
  }

  const plan = await prisma.contentPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== userId) {
    return { ok: false, error: fail('规划不存在', 404) };
  }
  if (dayIndex < 1 || dayIndex > plan.totalDays) {
    return { ok: false, error: fail('dayIndex 超出规划范围', 400) };
  }

  const day = await prisma.contentPlanDay.findUnique({
    where: { planId_dayIndex: { planId: plan.id, dayIndex } },
  });
  if (!day) {
    return { ok: false, error: fail('这一天不存在', 404) };
  }

  return { ok: true, plan, day };
}

function validateField(
  value: unknown,
  fieldName: string,
  max: number,
): { ok: true; value: string } | { ok: false; error: ReturnType<typeof fail> } {
  if (typeof value !== 'string') {
    return { ok: false, error: fail(`${fieldName} 必须是字符串`, 400) };
  }
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > max) {
    return { ok: false, error: fail(`${fieldName} 必须是 3-${max} 字符`, 400) };
  }
  return { ok: true, value: trimmed };
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; dayIndex: string } },
): Promise<Response> {
  let body: {
    action?: unknown;
    topic?: unknown;
    angle?: unknown;
    hookDirection?: unknown;
    scriptDraftId?: unknown;
    videoProductionId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const user = await getOrCreateDefaultUser();
  const loaded = await loadOwnedDay(user.id, params.id, params.dayIndex);
  if (!loaded.ok) return loaded.error;
  const { day } = loaded;

  if (body.action === 'edit') {
    if (day.status !== 'pending') {
      return fail('已生成脚本/成片的天不能改选题——要改内容去重新生成脚本', 409);
    }

    const data: { topic?: string; angle?: string; hookDirection?: string; edited: true } = {
      edited: true,
    };
    if (body.topic !== undefined) {
      const v = validateField(body.topic, 'topic', 60);
      if (!v.ok) return v.error;
      data.topic = v.value;
    }
    if (body.angle !== undefined) {
      const v = validateField(body.angle, 'angle', 120);
      if (!v.ok) return v.error;
      data.angle = v.value;
    }
    if (body.hookDirection !== undefined) {
      const v = validateField(body.hookDirection, 'hookDirection', 120);
      if (!v.ok) return v.error;
      data.hookDirection = v.value;
    }
    if (data.topic === undefined && data.angle === undefined && data.hookDirection === undefined) {
      return fail('至少要改 topic/angle/hookDirection 中的一个', 400);
    }

    const updated = await prisma.contentPlanDay.update({ where: { id: day.id }, data });
    return ok(updated);
  }

  if (body.action === 'mark-scripted') {
    const scriptDraftId = typeof body.scriptDraftId === 'string' ? body.scriptDraftId.trim() : '';
    if (!scriptDraftId) return fail('scriptDraftId 不能为空', 400);

    // 幂等: 已经是 scripted 且同一份稿子, 直接返回不动。
    if (day.status === 'scripted' && day.scriptDraftId === scriptDraftId) {
      return ok(day);
    }
    if (day.status !== 'pending') {
      return fail('这一天不是待写稿状态, 不能标记为已写稿', 409);
    }

    const draft = await prisma.scriptDraft.findUnique({ where: { id: scriptDraftId } });
    if (!draft || draft.userId !== user.id) {
      return fail('稿子不存在', 404);
    }

    const updated = await prisma.contentPlanDay.update({
      where: { id: day.id },
      data: { status: 'scripted', scriptDraftId: draft.id },
    });
    return ok(updated);
  }

  if (body.action === 'mark-produced') {
    const videoProductionId =
      typeof body.videoProductionId === 'string' ? body.videoProductionId.trim() : '';
    if (!videoProductionId) return fail('videoProductionId 不能为空', 400);

    // 幂等: 已经是 produced 且同一条成片, 直接返回不动。
    if (day.status === 'produced' && day.videoProductionId === videoProductionId) {
      return ok(day);
    }
    if (day.status !== 'scripted') {
      return fail('这一天还没生成脚本, 不能标记为已出片', 409);
    }

    const production = await prisma.videoProduction.findUnique({ where: { id: videoProductionId } });
    if (!production || production.userId !== user.id) {
      return fail('成片不存在', 404);
    }

    const updated = await prisma.contentPlanDay.update({
      where: { id: day.id },
      data: { status: 'produced', videoProductionId: production.id },
    });
    return ok(updated);
  }

  return fail('action 不合法, 只支持 edit/mark-scripted/mark-produced', 400);
}
