import { randomUUID } from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { videoProductionQueue } from '@/jobs/queue';
import { synthesizeSrtFromSixActScript } from '@/lib/video-production/srt-synthesis';
import { SixActScriptSchema, type ScriptAct } from '@/lib/script/six-act';
import { parseDraftOutput } from '@/lib/cockpit/draft-restore';
import { bumpCockpitRev } from '@/lib/cockpit/server-store';

/**
 * 模板页发起出片(二十期)。两种入口:
 * - `contentId`: 用已有内容卡的六幕定稿;
 * - `script`: 粘贴/灵感出稿确认后的六幕稿 —— 自动建一张内容卡再发起, 让成片天然进入
 *   现有内容总览与复盘闭环, 而不是另起一套平行体系。
 *
 * 修复(收到 review 反馈后): `ScriptDraft.output` 落库/读取**必须**统一走
 * `parseDraftOutput`(`draft-restore.ts`)认的嵌套形状 `{ script: { acts }, four_dims, ... }`
 * —— 这不只是本路由自己的读取约定, 更是 `video-production-worker.ts` 里
 * `handleTalkingHeadBroll`/`handleIllustrationTts`/`loadNarrations` 三处消费同一份
 * `ScriptDraft.output` 时唯一认的判别入口。上一版把 script 分支写成扁平
 * `{ acts, four_dims }`(没有 `script` 包装层), worker 侧 `parseDraftOutput` 解不出
 * `acts`, 会导致「粘贴新写」「灵感出稿」两条来源在真人出镜/插画配音两种模式下
 * 直接抛错「需要先生成六幕脚本」, 字幕烧录也会因 `loadNarrations` 拿到 `{}` 丢台词。
 * 现在写库改回嵌套形状、contentId 分支的读取改回 `parseDraftOutput`, 与
 * `video-productions/route.ts`/worker 保持同一套判别口径。
 */
// 缺口2(task-10b): 本次任务的临时配音覆盖, 只对 illustration-tts 有意义——但这里不按
// 交付模式收窄校验, 因为字段本身跟交付模式无关, 校验该独立于"是否会被消费"存在。
const VoiceOverrideSchema = z.object({
  voiceType: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
}).strict();

export async function POST(req: Request, { params }: { params: { id: string } }) {
  let body: { contentId?: unknown; script?: unknown; title?: unknown; voiceOverride?: unknown };
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }

  let voiceOverride: Prisma.InputJsonValue | null = null;
  if (body.voiceOverride !== undefined) {
    const parsedVoiceOverride = VoiceOverrideSchema.safeParse(body.voiceOverride);
    if (!parsedVoiceOverride.success) return fail('临时配音覆盖格式不合法', 400);
    voiceOverride = parsedVoiceOverride.data as unknown as Prisma.InputJsonValue;
  }

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
    const parsed = draft ? parseDraftOutput(draft.output) : null;
    if (!parsed?.acts || !parsed.four_dims) return fail('需要先生成六幕脚本', 400);
    contentId = content.id;
    acts = parsed.acts;
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
    //
    // output 形状必须照抄 `scripts/generate/route.ts:194` 的嵌套约定
    // (`script: { acts }` + 顶层 `four_dims`) —— 这是 `parseDraftOutput` 唯一认的判据,
    // 也是 worker 三处消费点(见上方函数注释)读六幕稿的唯一入口。research/hooks/titles/
    // cover 这几个字段属于完整写稿链路(研究/多候选标题与钩子/封面文案)的产物, 模板这条
    // 简化路径(粘贴/灵感 → 直接六幕稿, 没有 research 阶段, 也没有多候选)天然没有,
    // 缺省不写(parseDraftOutput 对应字段解析失败即跳过, 不影响 acts/four_dims 判别);
    // durationSec 有模板配置就带上, 供改稿抽屉重开时时长选择器正确回填。
    const durationSec = (template.scriptPrompt as { targetDurationSec?: number } | null)?.targetDurationSec;
    const draft = await prisma.scriptDraft.create({
      data: {
        userId: user.id,
        topic: title,
        niche: 'ai-knowledge',
        platform: 'douyin',
        output: {
          script: { acts: parsed.data.acts },
          four_dims: parsed.data.four_dims,
          ...(durationSec !== undefined ? { durationSec } : {}),
        } as unknown as Prisma.InputJsonValue,
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
      // Prisma 对可空 Json 字段的"未设置"用 undefined 表达(与本项目 palette/voicePreset
      // 等既有 Json? 字段一致的惯用法), null 需要专门的 Prisma.JsonNull——这里没有那个必要。
      voiceOverride: voiceOverride ?? undefined,
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
