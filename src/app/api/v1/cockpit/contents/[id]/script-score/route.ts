import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { SCRIPT_SOFT_SCORE, toSoftDimensions } from '@/lib/llm/prompts/script-soft-score';
import {
  combineScore,
  readActsFromDraftOutput,
  scriptFingerprint,
  SOFT_MODEL_VERSION,
  type CachedSoftScore,
} from '@/lib/cockpit/script-score';

/**
 * 口播稿评分 —— 软指标(二十二期)。
 *
 * 只有这一层要花钱, 所以做成**用户点按钮才跑**的 POST, 不在页面渲染时自动触发。
 * 硬指标不经过这里: 前端直接调 scoreHardDimensions 纯函数现算。
 */

/**
 * 读评分。硬指标每次现算(纯函数, 不花钱), 软指标读缓存 ——
 * **绝不在 GET 里触发模型调用**: 页面一刷新就扣一次钱, 用户根本没同意。
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const content = await prisma.cockpitContent.findUnique({ where: { id: params.id } });
  if (!content || content.userId !== user.id) return fail('内容不存在', 404);
  if (!content.scriptDraftId) return ok({ score: null });

  const draft = await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } });
  const acts = draft ? readActsFromDraftOutput(draft.output) : null;
  if (!acts) return ok({ score: null });

  return ok({ score: combineScore(acts, content.scriptScore) });
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const content = await prisma.cockpitContent.findUnique({ where: { id: params.id } });
  if (!content || content.userId !== user.id) return fail('内容不存在', 404);
  if (!content.scriptDraftId) return fail('这条内容还没有稿子, 先生成或写一份再评分', 400);

  const draft = await prisma.scriptDraft.findUnique({ where: { id: content.scriptDraftId } });
  const acts = draft ? readActsFromDraftOutput(draft.output) : null;
  if (!acts) return fail('这份稿子不是六幕结构, 评分标准对不上, 先转成六幕再评', 400);

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('服务端未配置 DEEPSEEK_API_KEY', 503);

  let cached: CachedSoftScore;
  try {
    const llm = getDeepSeekTextLLM(apiKey);
    const out = await llm.callStructured({
      systemPrompt: SCRIPT_SOFT_SCORE.buildSystemPrompt('ai-knowledge'),
      userMessage: SCRIPT_SOFT_SCORE.buildUserMessage({ acts }),
      responseSchema: SCRIPT_SOFT_SCORE.responseSchema,
    });
    cached = {
      // 指纹按打分时这一份稿子算 —— 之后稿子一改, 前端就知道这个分作废了
      fingerprint: scriptFingerprint(acts),
      modelVersion: SOFT_MODEL_VERSION,
      dimensions: toSoftDimensions(out.result),
      topFixes: out.result.topFixes,
      scoredAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[POST script-score]', e);
    return fail('评分失败, 请重试', 500);
  }

  await prisma.cockpitContent.update({
    where: { id: params.id },
    // Prisma 的 Json 入参类型要求索引签名, 具名 interface 过不了 —— 这里只是形状转换
    data: { scriptScore: cached as unknown as Prisma.InputJsonObject, updatedAt: new Date().toISOString() },
  });

  return ok({ score: combineScore(acts, cached) });
}
