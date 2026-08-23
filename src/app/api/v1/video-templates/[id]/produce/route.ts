import { randomUUID } from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { videoProductionQueue } from '@/jobs/queue';
import { synthesizeSrtFromSixActScript } from '@/lib/video-production/srt-synthesis';
import { SixActScriptSchema, type ScriptAct } from '@/lib/script/six-act';
import { bumpCockpitRev } from '@/lib/cockpit/server-store';

/**
 * 模板页发起出片(二十期)。两种入口:
 * - `contentId`: 用已有内容卡的六幕定稿;
 * - `script`: 粘贴/灵感出稿确认后的六幕稿 —— 自动建一张内容卡再发起, 让成片天然进入
 *   现有内容总览与复盘闭环, 而不是另起一套平行体系。
 *
 * 读取 `contentId` 分支下 `ScriptDraft.output` 时**不复用** `draft-restore.ts` 的
 * `parseDraftOutput` —— 那个解析器认的是 `/scripts/generate` 的落库形状
 * (`{ script: { acts }, four_dims, ... }`, acts 嵌在 `script` 键下)。本路由自己写的
 * `ScriptDraft`(见下面 script 分支)落的是 `SixActScriptSchema` 的原生扁平形状
 * (`{ acts, four_dims }`, 没有 `script` 包装层), 两种形状不通用, 直接用
 * `SixActScriptSchema` 校验/解析即可, 不必绕道 draft-restore 的多形态判别。
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let body: { contentId?: unknown; script?: unknown; title?: unknown };
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }

  const user = await getOrCreateDefaultUser();
  const template = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!template || template.userId !== user.id) return fail('模板不存在', 404);

  let contentId: string;
  let acts: ScriptAct[];

  if (typeof body.contentId === 'string' && body.contentId) {
    const content = await prisma.cockpitContent.findUnique({ where: { id: body.contentId } });
    if (!content || content.userId !== user.id) return fail('内容不存在', 404);
    const draft = content.scriptDraftId
      ? await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } })
      : null;
    // ScriptDraft.output 是 Json 列, 真实 Prisma 读回来已是解析好的对象; 但也容错
    // 处理字符串形态(例如测试 mock 直接塞了 JSON.stringify 的结果), 双路径都能解析。
    const rawOutput = draft ? (typeof draft.output === 'string' ? safeJsonParse(draft.output) : draft.output) : null;
    const parsed = rawOutput ? SixActScriptSchema.safeParse(rawOutput) : null;
    if (!parsed?.success) return fail('需要先生成六幕脚本', 400);
    contentId = content.id;
    acts = parsed.data.acts;
  } else if (body.script) {
    const parsed = SixActScriptSchema.safeParse(body.script);
    if (!parsed.success) return fail('六幕脚本形状不合法', 400);
    const now = new Date().toISOString();
    const newContentId = randomUUID();
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : '未命名内容';

    // Json 必填字段 (topic/script/metrics/review) 沿用 use-workspace-state.ts 的
    // createContent 对应的空白骨架 (blankTopic/blankScript 与 metrics/review 默认值),
    // 与手动新建内容卡时前端写下的默认结构一致 —— 填 `{}` 会让 content-detail.tsx 读
    // `item.topic.score.audience` 之类字段时因 undefined 崩溃。
    const content = await prisma.cockpitContent.create({
      data: {
        id: newContentId,
        userId: user.id,
        title,
        idea: title,
        platform: 'douyin',
        deliveryMode: template.deliveryMode,
        stage: 'script',
        topic: {
          audience: '', painPoint: '', pointOfView: '', commonAngle: '', contrastAngle: '',
          assets: '', minimumProduction: '',
          score: { audience: 0, pain: 0, scene: 0, demonstrable: 0, distribution: 0, efficiency: 0 },
        } as unknown as Prisma.InputJsonValue,
        script: {
          headline: '', hook: '', conclusion: '', body: '', example: '', ending: '',
        } as unknown as Prisma.InputJsonValue,
        metrics: {
          views: 0, likes: 0, saves: 0, comments: 0, followerGain: 0, capturedAt: '',
        } as unknown as Prisma.InputJsonValue,
        review: {
          rating: 0, analysis: '', learnedRule: '', completedAt: '',
        } as unknown as Prisma.InputJsonValue,
        createdAt: now,
        updatedAt: now,
      },
    });
    // ScriptDraft 必填字段 (topic/niche) 照 prisma/schema.prisma 的 ScriptDraft model:
    // topic/niche 都是必填 String, 不是 Json 里的自由字段——topic 用写稿主题本身,
    // niche 与本路由写稿时用的默认垂类保持一致 (见 script/route.ts 的 DEFAULT_NICHE)。
    const draft = await prisma.scriptDraft.create({
      data: {
        userId: user.id,
        topic: title,
        niche: 'ai-knowledge',
        platform: 'douyin',
        output: parsed.data as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.cockpitContent.update({
      where: { id: content.id },
      data: { scriptDraftId: draft.id, updatedAt: new Date().toISOString() },
    });
    // 服务端直写 cockpit 数据必须 bump rev, 否则前端读到脏缓存(既有教训)。
    await bumpCockpitRev(user.id);

    contentId = content.id;
    acts = parsed.data.acts;
  } else {
    return fail('需要 contentId 或 script', 400);
  }

  const srt = synthesizeSrtFromSixActScript(acts);
  const id = randomUUID().slice(0, 12);
  const productionRoot = path.join(process.env.VIDEO_PRODUCTION_ROOT || './video-productions', id);
  await fs.mkdir(productionRoot, { recursive: true });

  const now = new Date().toISOString();
  const vp = await prisma.videoProduction.create({
    data: {
      id,
      userId: user.id,
      contentId,
      templateId: template.id,
      mode: template.deliveryMode,
      srt,
      productionRoot,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    },
  });

  // 真人出镜模式先不入队 —— 等 upload-source 落地 sourceVideoPath 后再触发,
  // 避免 worker 在视频还没上传时立即失败(与十九期既有节奏一致)。
  if (template.deliveryMode !== 'talking-head-broll') {
    await videoProductionQueue.add('produce', { videoProductionId: id, mode: 'preview' });
  }

  return ok({ videoProductionId: vp.id, status: vp.status, contentId });
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
