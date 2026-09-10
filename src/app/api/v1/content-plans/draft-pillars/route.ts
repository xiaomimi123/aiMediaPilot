import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { CONTENT_PLAN_DRAFT_PILLARS } from '@/lib/llm/prompts';

/**
 * 月度内容规划向导 (三十八期 Task 4) — 第①步「做什么方向」起草接口。
 *
 * 起草不落库: 只把用户的自由文本喂给 LLM, 原样把 pillars 草稿返回给前端表单
 * 回填, 用户编辑确认后由向导最后一步统一走 `PUT /api/v1/persona/profile` 保存
 * (同 `persona/draft` 路由的两段式先例)。
 *
 * 为什么新建而不是复用 `POST /api/v1/persona/draft`: 那条路由要求固定形状的
 * 9 问 `answers` 数组, 且输出必须同时给够 painPoints(3-6 条)/offerings(1-5 条)/
 * productLogic(20-500 字) 三个此处完全没有素材支撑的字段(向导第①步只有一段
 * 自由文本, 硬套会逼 AI 编造)。本路由输入输出都收窄到向导实际需要的最小形状。
 * 详见 `lib/llm/prompts/content-plan-draft-pillars.ts` 顶部注释。
 */
const DraftPillarsRequestSchema = z.object({
  freeText: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const parsed = DraftPillarsRequestSchema.safeParse(body);
  if (!parsed.success) return fail(`输入不合法: ${parsed.error.message}`, 400);

  const user = await getOrCreateDefaultUser();
  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('服务端未配置 DEEPSEEK_API_KEY', 503);

  const llm = getDeepSeekTextLLM(apiKey);
  try {
    const out = await llm.callStructured({
      systemPrompt: CONTENT_PLAN_DRAFT_PILLARS.buildSystemPrompt(),
      userMessage: CONTENT_PLAN_DRAFT_PILLARS.buildUserMessage(parsed.data.freeText),
      responseSchema: CONTENT_PLAN_DRAFT_PILLARS.responseSchema,
    });
    return ok({ pillars: out.result.pillars });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST content-plans/draft-pillars]', e);
    return fail(`起草失败: ${msg}`, 500);
  }
}
