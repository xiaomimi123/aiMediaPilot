import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { FilmPlanSchema, type FilmPlan } from '@/lib/video-production/shot-plan';
import { timingCheckerFor } from '@/lib/video-production/film-plan-timing';
import type { AlignedAct } from '@/lib/video-production/aligner-prompt';
import { probeVideoDurationMs } from '@/lib/video/ffmpeg';

/**
 * 剪辑台的 FilmPlan 读写 API(三十一期 Task 2)。
 *
 * 产品背景: 任务停在 `plan_ready` 后(Task 1 已落地), 剪辑台 UI(Task 4)要读方案、
 * 改方案。本任务只做 API——GET 取方案 + 剪辑台需要的上下文, PUT 全量替换方案。
 *
 * **全量替换而非逐镜 PATCH**: FilmPlan 就几 KB, 全量简单且能走完整的校验链
 * (schema + 时间轴), 逐镜 PATCH 反而要操心"部分更新会不会破坏时间轴不变量"这类
 * 更复杂的问题, 不值得为一个体积很小的对象引入这层复杂度。
 */

/** 取模板。templateId 为空(内容详情页旧入口)时返回 null——与 worker 里的
 * `templateOf` 同一先例(该文件未导出, 这里独立写一份而不是跨文件 import 一个
 * 内部辅助函数)。 */
async function templateOf(templateId: string | null) {
  return templateId ? prisma.videoTemplate.findUnique({ where: { id: templateId } }) : null;
}

/**
 * 渲染层 `visualStyle`(与 `video-template/model.ts` 的模板字段 `visualStyle` 是
 * 两个不相干的概念, 见 worker `handlePptNarrationRemotion` 顶部注释)——
 * ppt-narration/talking-head-broll 传 'card', illustration-tts 传 'illustration',
 * 照抄 worker 里 `PPT_NARRATION_REMOTION_OPTIONS`/`ILLUSTRATION_TTS_REMOTION_OPTIONS`/
 * `handleTalkingHeadBrollRemotion` 里那个写死的 'card' 字面量三处判断。
 */
function visualStyleForMode(mode: string): 'card' | 'illustration' {
  return mode === 'illustration-tts' ? 'illustration' : 'card';
}

/**
 * 过滤掉零时长窗口后的幕边界——照抄 worker 里"过滤掉零时长窗口(二十九期终审修复)"
 * 那处注释同一份逻辑(`actWindowsFromAligned(...).filter((w) => w.endMs > w.startMs)`)。
 * 这里不需要重新 join 六幕脚本的 title/narration(那两个字段只用于喂给模型的提示词,
 * 不影响时间轴校验/总时长计算), 直接对已经落库的 `alignedActs` 取 startMs/endMs
 * 就是同一组数值——`actWindowsFromAligned` 只是把 `aligned` 按 `acts` 的顺序重新
 * 包一层, 不改动数值本身。
 */
function nonZeroAlignedWindows(alignedActs: unknown): { startMs: number; endMs: number }[] {
  const aligned = (alignedActs as unknown as AlignedAct[] | null) ?? [];
  return aligned
    .filter((w) => w.endMs > w.startMs)
    .map((w) => ({ startMs: w.startMs, endMs: w.endMs }));
}

/**
 * 剪辑台"时间窗编辑的总量锁定值"——照抄 worker 现状, 别另立口径:
 * - `talking-head-broll`: 源视频真实时长(ffprobe), 不是幕窗口总和——出镜链画面
 *   全程有源视频铺底(见 `handleTalkingHeadBrollRemotion` 里 `sourceMs` 同一段注释)。
 * - 其余两条链(ppt-narration/illustration-tts): 过滤零时长窗口后最后一个窗口的
 *   `endMs`(见 `handlePptNarrationRemotion` 里 `totalMs` 那一行, 窗口数组为空则 0)。
 */
async function computeTotalMs(vp: {
  mode: string;
  sourceVideoPath: string | null;
  alignedActs: unknown;
}): Promise<number> {
  if (vp.mode === 'talking-head-broll') {
    if (!vp.sourceVideoPath) return 0;
    return (await probeVideoDurationMs(vp.sourceVideoPath)) ?? 0;
  }
  const windows = nonZeroAlignedWindows(vp.alignedActs);
  return windows.length > 0 ? windows[windows.length - 1].endMs : 0;
}

/**
 * GET: 取 FilmPlan + 剪辑台需要的上下文。
 *
 * 404/鉴权照 `[id]/route.ts` 先例——归属校验用 404 而非 403, 不裸露资源存在性。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);

  const template = await templateOf(vp.templateId);
  // aspect 推导照抄 worker 现状: 模板 aspect==='9:16' 才是竖屏, 其余(含未设置的
  // 老模板)一律按横屏走。
  const aspect = template?.aspect === '9:16' ? '9:16' : '16:9';
  const totalMs = await computeTotalMs(vp);

  return ok({
    id: vp.id,
    filmPlan: vp.filmPlan,
    // 幕边界(时间窗编辑要用)——原样返回, 剪辑台按幕分组展示分镜。
    alignedActs: vp.alignedActs,
    mode: vp.mode,
    visualStyle: visualStyleForMode(vp.mode),
    aspect,
    totalMs,
  });
}

const PutBodySchema = z.object({ plan: z.unknown() });

/**
 * zod issue → 一句人话, 与 `film-plan-builder.ts` 的 `describeZodIssues` 同一
 * 格式(`path: message`)——那个函数没有导出(模块私有, 服务修复循环内部),
 * 这里的场景(把 schema 失败原样报给剪辑台用户/前端)不需要复用它的调用形状
 * (它内部自己重新 `safeParse` 一遍), 独立写一份更直接。
 */
function describeSchemaIssues(plan: unknown): string[] {
  const r = FilmPlanSchema.safeParse(plan);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const path = i.path.join('.');
    return path ? `${path}: ${i.message}` : i.message;
  });
}

/**
 * PUT: 全量替换 FilmPlan。校验链——结构(`FilmPlanSchema.safeParse`) → 时间轴
 * (`timingCheckerFor` 按 mode/layout 选对校验器, 与 worker 共用同一份选择逻辑,
 * 不再各写一份三元判断)。任一层校验失败都是 400, body 里带错误文案数组——
 * 就是校验器返回的那些字符串, 它们已被实测打磨过, 人读的和模型读的是同一套。
 *
 * 只允许 `status === 'plan_ready'` 的任务写: 渲染中/已完成改方案没有意义
 * (worker 早已用它渲完或正在渲), 且会撕裂状态(界面显示"已完成", 库里方案却
 * 悄悄换了一份, 跟成片对不上)。
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }
  const parsedBody = PutBodySchema.safeParse(body);
  if (!parsedBody.success) return fail('请求体格式不对, 需要 { plan }', 400);

  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);

  if (vp.status !== 'plan_ready') {
    return fail(`这条任务当前是「${vp.status}」, 不是「分镜待确认」, 不能编辑方案`, 400);
  }

  const schemaResult = FilmPlanSchema.safeParse(parsedBody.data.plan);
  if (!schemaResult.success) {
    return fail('分镜方案格式不对', 400, { errors: describeSchemaIssues(parsedBody.data.plan) });
  }
  const plan: FilmPlan = schemaResult.data;

  const template = await templateOf(vp.templateId);
  // layout 选择照抄 worker: template.talkingHeadLayout==='pip' 才是 pip, 其余
  // (含未设置/非 talking-head-broll 的任务, layout 对它们无意义)按 cutaway 走——
  // timingCheckerFor 对非 talking-head-broll 的 mode 根本不看这个参数。
  const layout: 'cutaway' | 'pip' = template?.talkingHeadLayout === 'pip' ? 'pip' : 'cutaway';
  const windows = nonZeroAlignedWindows(vp.alignedActs);
  const totalMs = await computeTotalMs(vp);

  const checkTiming = timingCheckerFor(vp.mode, layout, windows);
  const issues = checkTiming(plan, totalMs);
  if (issues.length > 0) {
    return fail('分镜方案时间轴校验未通过', 400, { errors: issues });
  }

  /*
   * 条件更新而不是无条件 update(三十一期 Task 2 复审): 前面的 plan_ready 校验只在
   * 读的那一刻成立 —— 若切换渲染器恰好在"读之后、写之前"把任务退回 queued 并清掉
   * alignedActs, 无条件写会把一份基于已作废 windows 校验通过的方案回写进去, 且用户
   * 收到 200(编辑被无声丢弃比报错糟)。updateMany 带 status 条件 = 乐观并发控制:
   * count 为 0 说明状态在读写之间变了, 明说重试。
   */
  const written = await prisma.videoProduction.updateMany({
    where: { id: params.id, status: 'plan_ready' },
    data: {
      filmPlan: plan as unknown as Prisma.InputJsonValue,
      updatedAt: new Date().toISOString(),
    },
  });
  if (written.count === 0) {
    return fail('任务状态刚刚变化(可能切换了渲染器或已开始处理), 请刷新后重试', 409);
  }

  // Task 3 的 still 缓存在此失效——本任务(Task 2)只留挂点, 不实现。方案改了,
  // 卡面预览多半也变了, Task 3 落地后应在这次 update 之后让该任务的卡面缓存
  // (还没实现)失效, 否则剪辑台会显示改动前的旧预览图。

  return ok({ id: vp.id, filmPlan: plan });
}
