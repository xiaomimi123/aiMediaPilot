/**
 * 「今天出一条」—— 对话式出片的零闸口链(2026-09-15 方向转型)。
 *
 * 背景: 面板流水线有六道人工闸口(选题→写稿→选模板→确认分镜→渲染→确认导出),
 * 真实使用数据是 23 条任务 0 条走到 master、16 条永远停在 preview_ready ——
 * 每个"你来把关"的闸口都是弃坑点。用户拍板: 选题文案由对话里的模型直接给,
 * 产品只干一件事 —— 把稿子变成片。
 *
 * 这条链把全部闸口焊死: 取今日选题(或指定题目/指定稿) → 生成六幕稿 →
 * 发起出片(reviewBeforeRender 直接关掉) → 盯渲染 → preview_ready 自动确认 →
 * master 渲完打印成品路径。人只在拿到 mp4 之后表态。
 *
 * 用法(dev server + worker 都要在跑):
 *   npx tsx scripts/produce-one.ts                    # 今日规划选题
 *   npx tsx scripts/produce-one.ts --topic "..."      # 指定题目
 *   npx tsx scripts/produce-one.ts --script <draftId> # 已有稿直接出片
 *   npx tsx scripts/produce-one.ts --template <id>    # 指定模板(默认图文口播)
 *
 * 真人出镜模板不在此链范围: 它必须等你上传口播视频, 天生有一道人工步骤。
 * 传了 talking-head 模板会直接拒绝并说明。
 */
import { prisma } from '../src/lib/prisma';
import { dayIndexFor, localDateString } from '../src/lib/content-plan/day-index';

const BASE = process.env.MEDIAPILOT_BASE ?? 'http://localhost:3000';
/** 默认模板: 图文口播(ppt-narration, 验收过的 Remotion 填槽链)。 */
const DEFAULT_TEMPLATE_NAME = '图文口播';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function api(path: string, body?: unknown): Promise<{ success?: boolean; data?: Record<string, unknown>; message?: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${json?.message ?? '未知错误'}`);
  return json;
}

async function patchDay(planId: string, dayIndex: number, body: Record<string, unknown>): Promise<void> {
  // 状态回填失败不阻塞出片 —— 规划页少记一笔, 片子照出(与今日卡 syncFailed 同语义)
  await fetch(`${BASE}/api/v1/content-plans/${planId}/days/${dayIndex}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 等任务到达目标状态之一; failed 立刻抛错并带上失败原因。 */
async function waitFor(id: string, targets: string[], label: string): Promise<string> {
  let last = '';
  for (;;) {
    const vp = await prisma.videoProduction.findUnique({
      where: { id },
      select: { status: true, errorMessage: true },
    });
    if (!vp) throw new Error(`任务 ${id} 不见了`);
    if (vp.status !== last) {
      console.log(`  [${label}] ${vp.status}`);
      last = vp.status;
    }
    if (vp.status === 'failed') throw new Error(`渲染失败: ${vp.errorMessage ?? '(无错误信息)'}`);
    if (targets.includes(vp.status)) return vp.status;
    await sleep(5000);
  }
}

async function main() {
  // ── 1. 定稿子 ──────────────────────────────────────────────
  let scriptDraftId = arg('script');
  let planDay: { planId: string; dayIndex: number } | null = null;

  if (!scriptDraftId) {
    let topic = arg('topic');
    let materials: string | undefined;

    if (!topic) {
      const plan = await prisma.contentPlan.findFirst({
        where: { status: 'active' },
        select: { id: true, startDate: true, totalDays: true },
      });
      if (!plan) throw new Error('没有活跃规划, 也没传 --topic/--script —— 至少给一个来源');
      const dayIndex = dayIndexFor(plan.startDate, localDateString(), plan.totalDays);
      if (dayIndex === null) throw new Error('今天不在规划范围内, 用 --topic 指定题目');
      const day = await prisma.contentPlanDay.findUnique({
        where: { planId_dayIndex: { planId: plan.id, dayIndex } },
        select: { topic: true, angle: true, hookDirection: true, status: true, scriptDraftId: true },
      });
      if (!day) throw new Error(`规划第 ${dayIndex} 天不存在`);
      planDay = { planId: plan.id, dayIndex };
      console.log(`▸ 今日(第 ${dayIndex} 天)选题: ${day.topic}`);
      if (day.status !== 'pending' && day.scriptDraftId) {
        // 今天已生成过脚本 —— 直接复用, 不重写
        scriptDraftId = day.scriptDraftId;
        console.log(`▸ 复用今天已生成的脚本 ${scriptDraftId}`);
      } else {
        topic = day.topic;
        materials = `角度: ${day.angle}；钩子方向: ${day.hookDirection}`;
      }
    }

    if (!scriptDraftId) {
      console.log('▸ 生成六幕脚本…');
      const res = await api('/api/v1/scripts/generate', {
        topic,
        niche: 'ai-knowledge',
        platform: 'douyin',
        durationSec: 60,
        mode: 'full',
        ...(materials ? { materials } : {}),
      });
      scriptDraftId = res.data?.scriptDraftId as string;
      if (!scriptDraftId) throw new Error('脚本生成没有返回 scriptDraftId');
      console.log(`▸ 脚本已生成: ${scriptDraftId}`);
      if (planDay) await patchDay(planDay.planId, planDay.dayIndex, { action: 'mark-scripted', scriptDraftId });
    }
  }

  // ── 2. 定模板(拒绝真人出镜 —— 那条链必须等上传视频, 不属于零闸口范围) ──
  const templateId = arg('template');
  const template = templateId
    ? await prisma.videoTemplate.findUnique({ where: { id: templateId }, select: { id: true, name: true, deliveryMode: true } })
    : await prisma.videoTemplate.findFirst({ where: { name: DEFAULT_TEMPLATE_NAME }, select: { id: true, name: true, deliveryMode: true } });
  if (!template) throw new Error(templateId ? `模板 ${templateId} 不存在` : `找不到默认模板「${DEFAULT_TEMPLATE_NAME}」, 用 --template 指定`);
  if (template.deliveryMode === 'talking-head-broll') {
    throw new Error(`「${template.name}」是真人出镜模板, 必须先拍口播视频再上传, 走不了全自动 —— 换图文口播/插画配音, 或去面板走出镜流程`);
  }
  console.log(`▸ 模板: ${template.name}(${template.deliveryMode})`);

  // ── 3. 发起出片 + 焊死人工闸口 ─────────────────────────────
  const produced = await api(`/api/v1/video-templates/${template.id}/produce`, { scriptDraftId });
  const vpId = produced.data?.videoProductionId as string;
  if (!vpId) throw new Error('出片没有返回 videoProductionId');
  console.log(`▸ 出片任务: ${vpId}`);
  if (planDay) await patchDay(planDay.planId, planDay.dayIndex, { action: 'mark-produced', videoProductionId: vpId });

  // 关掉分镜确认闸口。与已入队 job 有一个极小的竞态窗口: 万一 worker 抢在这行
  // 之前读了旧值停在 plan_ready, 下面的兜底会调 /render 把它推过去。
  await prisma.videoProduction.update({ where: { id: vpId }, data: { reviewBeforeRender: false } });

  // ── 4. 盯预览渲染(plan_ready 是竞态兜底, 到了就自动确认继续) ──
  let status = await waitFor(vpId, ['preview_ready', 'plan_ready'], '渲染');
  if (status === 'plan_ready') {
    console.log('▸ (竞态兜底)自动确认分镜, 继续渲染');
    await api(`/api/v1/cockpit/video-productions/${vpId}/render`, {});
    status = await waitFor(vpId, ['preview_ready'], '渲染');
  }

  // ── 5. 自动确认导出 → master ───────────────────────────────
  console.log('▸ 预览就绪, 自动确认导出, 渲染正式成片…');
  await api(`/api/v1/cockpit/video-productions/${vpId}/approve`, {});
  await waitFor(vpId, ['done'], '成片');

  const final = await prisma.videoProduction.findUnique({ where: { id: vpId }, select: { masterPath: true } });
  console.log('');
  console.log('✅ 成片完成');
  console.log(`   文件: ${final?.masterPath}`);
  console.log(`   详情页: ${BASE}/films/${vpId}`);
}

main()
  .catch((e) => {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
