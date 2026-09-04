import { randomUUID } from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { videoProductionQueue } from '@/jobs/queue';
import { synthesizeSrtFromSixActScript } from '@/lib/video-production/srt-synthesis';
import { parseDraftOutput } from '@/lib/cockpit/draft-restore';
import { defaultRendererForMode } from '@/lib/video-production/renderer';

// 三十期 Task 3: 旧渲染已下线, 新建任务只接受显式 renderer='remotion'
// (不传时走 defaultRendererForMode 的默认值); 'legacy' 一律拒绝。
const RendererSchema = z.literal('remotion');
// 三十一期(生成前剪辑台) Task 1: 生成前暂停点的开关, 创建路由可选传入。
const ReviewBeforeRenderSchema = z.boolean();

/**
 * 触发一次成片生成 (十八期 T8) — 六幕脚本 → SRT → 落一条 VideoProduction
 * → 入队 preview 模式渲染任务, 真正的 Director/Builder/渲染流水线由
 * videoProductionQueue 的 worker (T7) 消费。
 *
 * 十五期收尾 E2E 修复: `CockpitContent.script` 是"改稿摘要"字段 (script-mapping.ts
 * 的 mapDouyin 只把六幕稿摘要拍平成 hook/body 两个文本字段写回它, 从不落 acts/
 * four_dims 原始结构——参见该文件六幕分支注释), 真正完整的六幕结构只存在于
 * `ScriptDraft.output`(`CockpitContent.scriptDraftId` 指向的那条)。原实现直接读
 * `content.script.acts` 恒为 undefined, 走真实"用 AI 写脚本"UI 生成的内容永远会
 * 被挡在"需要先生成六幕脚本"报错前、无法进入生成流程。改为按 scriptDraftId 取
 * ScriptDraft 后用 draft-restore.ts 的 parseDraftOutput (六幕稿判别与前端抽屉懒
 * 加载复用同一份逻辑) 解出 acts/four_dims。
 */
export async function POST(req: Request) {
  let body: { contentId?: unknown; renderer?: unknown; reviewBeforeRender?: unknown };
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  if (typeof body.contentId !== 'string' || !body.contentId) return fail('缺少 contentId', 400);
  const contentId = body.contentId;

  let requestedRenderer: 'remotion' | undefined;
  if (body.renderer !== undefined) {
    const parsedRenderer = RendererSchema.safeParse(body.renderer);
    if (!parsedRenderer.success) return fail('旧渲染已下线，请使用新版渲染', 400);
    requestedRenderer = parsedRenderer.data;
  }

  // 三十一期(生成前剪辑台) Task 1: 生成前的暂停点开关, 可选——不传就吃 schema 默认值
  // true(缺省"渲染前先看一眼分镜")。不在这里显式兜底默认值, 是为了让 create 的
  // data 对象里不出现这个字段时, 交给 Prisma 的 @default(true) 去填, 单一处定义
  // 默认值, 不在路由这里重复一份容易漂移的常量。
  let requestedReviewBeforeRender: boolean | undefined;
  if (body.reviewBeforeRender !== undefined) {
    const parsedReview = ReviewBeforeRenderSchema.safeParse(body.reviewBeforeRender);
    if (!parsedReview.success) return fail('reviewBeforeRender 必须是布尔值', 400);
    requestedReviewBeforeRender = parsedReview.data;
  }

  try {
    const user = await getOrCreateDefaultUser();
    const content = await prisma.cockpitContent.findUnique({ where: { id: contentId } });
    if (!content || content.userId !== user.id) return fail('内容不存在', 404);

    const draft = content.scriptDraftId
      ? await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } })
      : null;
    const parsed = draft ? parseDraftOutput(draft.output) : null;
    if (!parsed?.acts || !parsed.four_dims) {
      return fail('需要先生成六幕脚本', 400);
    }

    const srt = synthesizeSrtFromSixActScript(parsed.acts);
    const id = randomUUID().slice(0, 12);
    const productionRoot = path.join(process.env.VIDEO_PRODUCTION_ROOT || './video-productions', id);
    await fs.mkdir(productionRoot, { recursive: true });

    // 十九期 T15 修复: 原实现从不写 mode 字段, 落库永远是 schema 默认值
    // 'ppt-narration'——导致 worker (十八期 T4-T7 的三分支 dispatch) 对
    // talking-head-broll/illustration-tts 内容也会走错分支, upload-source
    // 路由 (只认 mode==='talking-head-broll') 也永远 400。按 content.deliveryMode
    // 落 mode, 非三个合法值 (如 'manual'/未设置) 时兜底 'ppt-narration'。
    const mode = content.deliveryMode === 'talking-head-broll' || content.deliveryMode === 'illustration-tts'
      ? content.deliveryMode
      : 'ppt-narration';

    const vp = await prisma.videoProduction.create({
      data: {
        id,
        userId: user.id,
        contentId,
        mode,
        // 任务四: 缺省按落库后的 mode 走(不是按 body 的 deliveryMode)——ppt-narration
        // 缺省 remotion, 另两条链还没迁, 缺省 legacy; 显式传了就照用户说的来。
        renderer: requestedRenderer ?? defaultRendererForMode(mode),
        srt,
        productionRoot,
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // 不传时不写这个键, 交给 schema 的 @default(true) 兜底——理由见上面
        // requestedReviewBeforeRender 赋值处的注释。
        ...(requestedReviewBeforeRender !== undefined ? { reviewBeforeRender: requestedReviewBeforeRender } : {}),
      },
    });
    // talking-head-broll 需要先在「录制」步骤上传出镜视频 (upload-source 路由),
    // worker 的 handleTalkingHeadBroll 会在 sourceVideoPath 缺失时立即抛错且
    // 没有重试——这里不能像其它模式一样创建后立刻入队, 否则永远是一次性失败。
    // 入队改由 upload-source 路由在写入 sourceVideoPath 后触发。
    if (mode !== 'talking-head-broll') {
      await videoProductionQueue.add('produce', { videoProductionId: id, mode: 'preview' });
    }
    return ok({ id: vp.id, status: vp.status });
  } catch (e) {
    console.error('[POST cockpit/video-productions]', e);
    return fail(`生成失败: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
}
