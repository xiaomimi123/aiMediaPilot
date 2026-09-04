import fs from 'fs/promises';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { canSwitchRenderer } from '@/lib/cockpit/production-status';
import { isRemotionReadyMode } from '@/lib/video-production/renderer';

/**
 * 三十期 Task 3: 旧渲染层已下线, `renderer` 只接受 `'remotion'`——历史遗留的
 * `'legacy'` 值(prisma 字段 `@default("legacy")`, 历史数据不删)只能读, 不能写:
 * 任何试图把 renderer 切回/切成 'legacy' 的 PATCH 请求在这里就被拒绝, 不会等到
 * worker dispatch 那里才报错。
 */
const PatchBodySchema = z.object({
  renderer: z.literal('remotion'),
}).strict();

/**
 * 单条成片生成状态轮询 (十八期 T8) — 归属校验用 404 而非 403,
 * 与本项目既有约定一致 (不裸露资源存在性)。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);

  return ok({
    id: vp.id,
    status: vp.status,
    previewPath: vp.previewPath,
    masterPath: vp.masterPath,
    errorMessage: vp.errorMessage,
    // 轮询也要带上 —— 出片跑完那一刻页面是靠轮询更新的, 不带就得刷新才看得到体检结果
    freezeReport: vp.freezeReport,
    // 二十八期终审: 无声降级提醒。preview 跑完(building 阶段落库)才有值, 轮询要带上
    // 否则得手动刷新才看得到。
    productionNotice: vp.productionNotice,
  });
}

/**
 * 切换渲染器(任务四)——面板上「新版渲染/旧版渲染」的切换走这里。
 *
 * 只在任务还没开工(或分镜待确认)时允许切(`canSwitchRenderer`, 三十一期 Task 1
 * 从 `canStartProduction` 拆出——见该函数顶部注释)。切换必须把 `filmPlan`/`alignedActs` 一并清掉:
 * 这两个字段是上一条渲染链留下的方案/对齐结果, 换链之后对新链毫无意义 ——
 * 残留下来会让 master 阶段误以为有现成方案可以直接复用, 结果是拿旧链的产物拼新链的片子。
 *
 * 复审补的一条(同值 PATCH): 传的 renderer 跟当前值一样时直接原样返回、什么都不清——
 * 「什么都没变」的请求不该有副作用。没有这条防御的话, 对 failed 状态的任务重复
 * PATCH 同一个值一次就会把上一次的 filmPlan 白白清掉, 而 UI 上现有的切换按钮永远只发
 * 相反值、触发不到, 直接调 API 的调用方却毫无防御。
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: unknown;
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) return fail('旧渲染已下线，请使用新版渲染', 400);

  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);

  /*
   * 三十一期(生成前剪辑台) Task 1: 这里改用 `canSwitchRenderer`, 不是
   * `canStartProduction`——`plan_ready`(分镜待确认)也允许切换渲染器: 此时
   * plan 反正清空重来, 切换语义天然自洽; 但它不该被放进「开始制作」的清单里
   * (start=重新产 plan 会覆盖用户已调整的方案, 见 production-status.ts 顶部注释)。
   */
  if (!canSwitchRenderer(vp.status)) {
    return fail(`这条任务当前是「${vp.status}」, 已经在处理或已完成, 不能再切换渲染方式`, 400);
  }

  if (parsed.data.renderer === vp.renderer) {
    return ok({ id: vp.id, renderer: vp.renderer });
  }

  /*
   * 复审补(二十九期 Task 2 收尾): 只有 REMOTION_READY_MODES 里的交付模式才有对应
   * 的 Remotion handler(见 worker dispatch 里同一份清单)——切到 'remotion' 之前
   * 必须先确认 worker 真的接得住, 否则任务会卡在没人处理的分支, 用户还看着「新版
   * 渲染」的徽标以为在正常出片。切回 'legacy' 不受这条限制, 旧链所有 mode 都能接。
   */
  if (parsed.data.renderer === 'remotion' && !isRemotionReadyMode(vp.mode)) {
    return fail('该交付方式暂不支持新版渲染', 400);
  }

  const updated = await prisma.videoProduction.update({
    where: { id: params.id },
    data: {
      renderer: parsed.data.renderer,
      // Json? 字段清空传裸 null 过不了类型检查: update 输入类型是
      // `NullableJsonNullValueInput | InputJsonValue`, 不含裸 null, tsc 直接
      // 报 TS2322——这是编译期的约束, 不是运行时会把它当"未设置"忽略(复审用
      // 未类型化 JS 实测过: 运行时确实会写成 NULL)。Prisma.JsonNull 才是类型层
      // 认的"显式写入数据库 NULL"的表达方式。
      filmPlan: Prisma.JsonNull,
      alignedActs: Prisma.JsonNull,
      // 同一批"上一条渲染链留下的方案"——无声降级提醒也是上一次 preview 的判断结果,
      // 换链之后没有意义, 一并清掉(String? 字段裸 null 就够, 不需要 Prisma.JsonNull)。
      productionNotice: null,
      /*
       * plan_ready 的任务切换渲染器后必须退回 queued(三十一期 Task 1 复审):
       * 上面刚把 filmPlan 清空, 留着 plan_ready 会造出"无方案的待确认"状态 ——
       * 此时 /render 能过前置校验入队, worker 却因读不到 filmPlan 落 failed,
       * 一次无意义的 queued→failed 往返 + 一条让用户困惑的报错。
       * 退回 queued 让它走正常的重新生成路径。其它状态(queued/failed/...)不动。
       */
      ...(vp.status === 'plan_ready' ? { status: 'queued' } : {}),
      updatedAt: new Date().toISOString(),
    },
  });

  return ok({ id: updated.id, renderer: updated.renderer });
}

/** 进行中的状态 —— worker 还在往 productionRoot 写盘, 此时删目录会让它中途崩在莫名其妙的地方。 */
const IN_FLIGHT = new Set([
  'queued', 'source_uploaded', 'directing', 'building', 'assembling', 'approved', 'rendering', 'packaging',
]);

/**
 * 进行中的任务多久没动就算"卡死"。worker 每完成一镜就 setStatus 刷新 updatedAt,
 * 正常跑动时不会静默这么久; 超过就说明进程已经没了(真实踩过: 强杀 worker 后任务
 * 永远停在 building, 既跑不完也删不掉, 只能手动改库)。
 */
const STALE_MS = 30 * 60 * 1000;

function isStale(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false; // 拿不准就保守拒绝, 别误删真在跑的任务
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) && Date.now() - t > STALE_MS;
}

/**
 * 删除一次生成任务(二十一期) —— 真实使用提出: 成片库里堆着不满意的版本和失败的任务,
 * 没有任何清理手段。连同 productionRoot 下的分镜/中间产物/成片一并清掉, 否则磁盘只增不减。
 *
 * 进行中的任务拒绝删除而不是强删: 这是"删除"不是"取消", BullMQ 里的 job 不会因为记录没了
 * 就停下, 强删只会让它在写盘时崩在难以定位的地方。
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);

  if (IN_FLIGHT.has(vp.status) && !isStale(vp.updatedAt)) {
    return fail('任务进行中，等它跑完或失败后再删', 400);
  }

  await prisma.videoProduction.delete({ where: { id: params.id } });
  // 目录清理失败不阻断 —— 记录已经没了, 留个孤儿目录不影响正确性(同模板删除的既有语义)。
  await fs.rm(vp.productionRoot, { recursive: true, force: true }).catch(() => {});
  return ok({ deleted: true });
}
