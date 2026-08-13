import { ok, fail } from '@/lib/api';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import {
  SCRIPT_GENERATE_XIAOHONGSHU,
  SCRIPT_GENERATE_GONGZHONGHAO,
} from '@/lib/llm/prompts';
import { SCRIPT_WRITE_DOUYIN } from '@/lib/llm/prompts/script-write-douyin';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import type { InspirationStyleHints } from '@/lib/llm/prompts';
import { normalizeNiche } from '@/lib/niche';
import { isContentPlatform, type ContentPlatform } from '@/lib/platform';
import { readInspirationInsight } from '@/lib/json-readers';
import { runResearch } from '@/lib/script/research';
import { getStyleContext } from '@/lib/script/style';

const PROMPT_BY_PLATFORM = {
  xiaohongshu: SCRIPT_GENERATE_XIAOHONGSHU,
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

export async function POST(req: Request) {
  let body: {
    topic?: unknown;
    niche?: unknown;
    platform?: unknown;
    inspirationId?: unknown;
    materials?: unknown;
    durationSec?: unknown;
    cockpitContentId?: unknown;
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

  const user = await getOrCreateDefaultUser();
  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) {
    return fail('DEEPSEEK_API_KEY 未配置', 500);
  }

  if (platform === 'douyin') {
    try {
      const research = await runResearch(user.id, { topic, niche, userMaterials: materials });
      const style = await getStyleContext(user.id, 'douyin');
      const llm = getDeepSeekTextLLM(apiKey);
      const out = await llm.callStructured({
        systemPrompt: SCRIPT_WRITE_DOUYIN.buildSystemPrompt(niche, style),
        userMessage: SCRIPT_WRITE_DOUYIN.buildUserMessage({ topic, durationSec, brief: research }),
        responseSchema: SCRIPT_WRITE_DOUYIN.responseSchema,
      });
      const { sections, hooks, titles, cover } = out.result;

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
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[POST scripts/generate douyin]', e);
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
