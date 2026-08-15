import { ok, fail } from '@/lib/api';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { SCRIPT_GENERATE_GONGZHONGHAO } from '@/lib/llm/prompts';
import { SCRIPT_WRITE_DOUYIN } from '@/lib/llm/prompts/script-write-douyin';
import { SCRIPT_WRITE_XHS } from '@/lib/llm/prompts/script-write-xhs';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import type { InspirationStyleHints } from '@/lib/llm/prompts';
import { normalizeNiche } from '@/lib/niche';
import { isContentPlatform, type ContentPlatform } from '@/lib/platform';
import { readInspirationInsight } from '@/lib/json-readers';
import { runResearch } from '@/lib/script/research';
import { getStyleContext } from '@/lib/script/style';
import { loadPersonaProfile, validateIntent } from '@/lib/persona/profile';
import { buildPersonaSection } from '@/lib/llm/prompts/persona-section';
import { buildVoiceSection } from '@/lib/llm/prompts/voice-section';
import { loadCreatorVoice, loadExperiences } from '@/lib/persona/voice';
import { matchExperiences } from '@/lib/persona/experience-match';

const PROMPT_BY_PLATFORM = {
  gongzhonghao: SCRIPT_GENERATE_GONGZHONGHAO,
} as const;

const VALID_DURATIONS = [30, 45, 60] as const;
type DurationSec = (typeof VALID_DURATIONS)[number];

function isValidDuration(value: unknown): value is DurationSec {
  return typeof value === 'number' && (VALID_DURATIONS as readonly number[]).includes(value);
}

/**
 * best-effort 把新生成的 ScriptDraft 关联回抽屉打开时的 CockpitContent —— 抽屉重开靠
 * `CockpitContent.scriptDraftId` 恢复改稿 UI (T2)。归属校验/写入失败都不阻断生成响应,
 * 逻辑照抄 `src/app/api/v1/scripts/route.ts` 里 POST /api/v1/scripts 的同名处理。
 */
async function linkCockpitContent(
  userId: string,
  cockpitContentId: string,
  scriptDraftId: string,
): Promise<void> {
  try {
    const content = await prisma.cockpitContent.findUnique({
      where: { id: cockpitContentId },
      select: { id: true, userId: true },
    });
    if (content && content.userId === userId) {
      await prisma.cockpitContent.update({
        where: { id: cockpitContentId },
        data: { scriptDraftId },
      });
    }
  } catch (e) {
    console.warn('[POST scripts/generate] cockpit linkage failed', e);
  }
}

async function loadStyleHints(inspirationId: string): Promise<InspirationStyleHints | null> {
  try {
    const user = await getOrCreateDefaultUser();
    const insight = await prisma.inspirationInsight.findFirst({
      where: { id: inspirationId, userId: user.id },
      select: { output: true },
    });
    if (!insight) return null;
    const out = readInspirationInsight(insight.output);
    if (!out) return null;
    return {
      hookTypes: out.hookTypes,
      titlePatterns: out.titlePatterns,
      durationInsight: out.durationInsight,
    };
  } catch (e) {
    console.warn('[loadStyleHints]', e);
    return null;
  }
}

/**
 * 十二期: 写稿成功后给命中的经历计数 +1 —— 用于 UI 展示"这条经历被用过几次"。
 * best-effort: 计数失败不能影响已经生成好的稿子 (同 linkCockpitContent 容错先例)。
 */
async function bumpExperienceUsage(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await prisma.creatorExperience.updateMany({
      where: { id: { in: ids } },
      data: { usedCount: { increment: 1 } },
    });
  } catch (e) {
    console.warn('[scripts/generate] 经历引用计数失败', e instanceof Error ? e.message : e);
  }
}

export async function POST(req: Request) {
  let body: {
    topic?: unknown;
    niche?: unknown;
    platform?: unknown;
    inspirationId?: unknown;
    materials?: unknown;
    durationSec?: unknown;
    cockpitContentId?: unknown;
    intent?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const niche = normalizeNiche(typeof body.niche === 'string' ? body.niche : '');
  const platform: ContentPlatform = isContentPlatform(body.platform) ? body.platform : 'douyin';
  const inspirationId =
    typeof body.inspirationId === 'string' && body.inspirationId.length > 0
      ? body.inspirationId
      : null;

  if (topic.length < 3 || topic.length > 500) {
    return fail('topic 必须是 3-500 字符', 400);
  }
  if (!niche) {
    return fail('niche 不能为空', 400);
  }

  let durationSec: DurationSec = 45;
  if (body.durationSec !== undefined) {
    if (!isValidDuration(body.durationSec)) {
      return fail('durationSec 必须是 30/45/60', 400);
    }
    durationSec = body.durationSec;
  }
  const materials =
    typeof body.materials === 'string' && body.materials.trim() !== '' ? body.materials : undefined;
  const cockpitContentId =
    typeof body.cockpitContentId === 'string' ? body.cockpitContentId.trim() : '';
  // 十期: 内容意图 — 宽进严出, 非法值/未指定一律降为 '' (validateIntent 语义), 不单独报 400。
  const intent = validateIntent(body.intent);

  const user = await getOrCreateDefaultUser();
  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) {
    return fail('DEEPSEEK_API_KEY 未配置', 500);
  }

  if (platform === 'douyin') {
    try {
      // 十二期: 经历检索必须在 runResearch 之前 —— 命中的经历要作为最高优先级素材
      // 进研究层的 curatedParts (亲身经历 > 用户贴的第三方资料 > 搜索正文)。
      const matchedExperiences = matchExperiences(topic, await loadExperiences(user.id), 3);
      const research = await runResearch(user.id, {
        topic,
        niche,
        userMaterials: materials,
        experiences: matchedExperiences.map((e) => ({ content: e.content, kind: e.kind })),
      });
      const style = await getStyleContext(user.id, 'douyin');
      // 人设定位注入 (T4): 未建立档案时 personaSection 为空串, buildSystemPrompt 保持字符级一致
      // 十期: intent 透传给 buildPersonaSection, 非空时追加 CTA 指引段 (见 persona-section.ts)
      const profile = await loadPersonaProfile(user.id);
      const personaSection = buildPersonaSection(profile, 'write', intent);
      // 十二期: 人物志(你是谁) + 命中的个人经历(你凭什么这么说)。两者皆空时
      // voiceSection 为空串, 写稿 prompt 与十二期之前字符级一致 (零迁移)。
      const voice = await loadCreatorVoice(user.id);
      const voiceSection = buildVoiceSection(voice, matchedExperiences);
      const llm = getDeepSeekTextLLM(apiKey);
      const out = await llm.callStructured({
        systemPrompt: SCRIPT_WRITE_DOUYIN.buildSystemPrompt(niche, style, personaSection, voiceSection),
        userMessage: SCRIPT_WRITE_DOUYIN.buildUserMessage({ topic, durationSec, brief: research }),
        responseSchema: SCRIPT_WRITE_DOUYIN.responseSchema,
      });
      const { sections, hooks, titles, cover, suggestedIntent: rawSuggestedIntent } = out.result;
      // 十期: AI 自报的 suggestedIntent 同样过 validateIntent (宽进严出), 非法/未产出一律降为 null。
      const suggestedIntent = validateIntent(rawSuggestedIntent) || null;

      const draft = await prisma.scriptDraft.create({
        data: {
          userId: user.id,
          topic,
          niche,
          platform: 'douyin',
          output: { research, script: { sections }, hooks, titles, cover, durationSec },
        },
        select: { id: true },
      });
      await bumpExperienceUsage(matchedExperiences.map((e) => e.id));

      if (cockpitContentId) {
        await linkCockpitContent(user.id, cockpitContentId, draft.id);
      }

      return ok({
        platform,
        scriptDraftId: draft.id,
        research,
        researchDegraded: research === null,
        sections,
        hooks,
        titles,
        cover,
        durationSec,
        suggestedIntent,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[POST scripts/generate douyin]', e);
      return fail(`生成失败: ${msg}`, 500);
    }
  }

  if (platform === 'xiaohongshu') {
    try {
      // 十二期: 经历检索必须在 runResearch 之前 —— 命中的经历要作为最高优先级素材
      // 进研究层的 curatedParts (亲身经历 > 用户贴的第三方资料 > 搜索正文)。
      const matchedExperiences = matchExperiences(topic, await loadExperiences(user.id), 3);
      const research = await runResearch(user.id, {
        topic,
        niche,
        userMaterials: materials,
        experiences: matchedExperiences.map((e) => ({ content: e.content, kind: e.kind })),
      });
      const style = await getStyleContext(user.id, 'xiaohongshu');
      // 人设定位注入 (T4): 未建立档案时 personaSection 为空串, buildSystemPrompt 保持字符级一致
      // 十期: intent 透传给 buildPersonaSection, 非空时追加 CTA 指引段 (见 persona-section.ts)
      const profile = await loadPersonaProfile(user.id);
      const personaSection = buildPersonaSection(profile, 'write', intent);
      // 十二期: 同 douyin 分支 —— 人物志 + 命中经历, 皆空时保持字符级一致。
      const voice = await loadCreatorVoice(user.id);
      const voiceSection = buildVoiceSection(voice, matchedExperiences);
      const llm = getDeepSeekTextLLM(apiKey);
      const out = await llm.callStructured({
        systemPrompt: SCRIPT_WRITE_XHS.buildSystemPrompt(niche, style, personaSection, voiceSection),
        userMessage: SCRIPT_WRITE_XHS.buildUserMessage({ topic, brief: research }),
        responseSchema: SCRIPT_WRITE_XHS.responseSchema,
      });
      const { titles, coverText, intro, body, tags, shotIdeas, suggestedIntent: rawSuggestedIntent } = out.result;
      // 十期: AI 自报的 suggestedIntent 同样过 validateIntent (宽进严出), 非法/未产出一律降为 null。
      const suggestedIntent = validateIntent(rawSuggestedIntent) || null;

      const draft = await prisma.scriptDraft.create({
        data: {
          userId: user.id,
          topic,
          niche,
          platform: 'xiaohongshu',
          output: { research, titles, coverText, intro, body, tags, shotIdeas },
        },
        select: { id: true },
      });
      await bumpExperienceUsage(matchedExperiences.map((e) => e.id));

      if (cockpitContentId) {
        await linkCockpitContent(user.id, cockpitContentId, draft.id);
      }

      return ok({
        platform,
        scriptDraftId: draft.id,
        research,
        researchDegraded: research === null,
        titles,
        coverText,
        intro,
        body,
        tags,
        shotIdeas,
        suggestedIntent,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[POST scripts/generate xiaohongshu]', e);
      return fail(`生成失败: ${msg}`, 500);
    }
  }

  const styleHints = inspirationId ? await loadStyleHints(inspirationId) : null;

  const prompt = PROMPT_BY_PLATFORM[platform];
  const llm = getDeepSeekTextLLM(apiKey);
  try {
    const out = await llm.callStructured({
      systemPrompt: prompt.buildSystemPrompt(niche),
      userMessage: prompt.buildUserMessage({ topic, styleHints: styleHints ?? undefined }),
      // Each platform has its own zod schema (different shape); union ambiguates the T inference
      responseSchema: prompt.responseSchema as any,
    });
    return ok({
      platform,
      inspirationApplied: !!styleHints,
      ...(out.result as Record<string, unknown>),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST scripts/generate]', e);
    return fail(`生成失败: ${msg}`, 500);
  }
}
