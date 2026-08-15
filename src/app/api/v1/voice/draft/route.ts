import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { VOICE_DRAFT } from '@/lib/llm/prompts';

/**
 * 人物志 6 问访谈起草 (十二期 T2)。
 *
 * 沿八期语义: **草稿只回填表单不落库**, 用户改完点保存才走 PUT。本路由不写
 * CreatorVoice, 也不写 CreatorExperience —— 起草返回的 experienceCandidates 由前端
 * 展示给用户确认后, 逐条调 POST /api/v1/experiences 入库 (用户没确认的不入库)。
 *
 * niche 硬编码同 persona/draft 先例 (产品当前单赛道, 访谈不收集 niche)。
 */
const DEFAULT_NICHE = 'ai-knowledge';

const AnswerSchema = z.object({
  q: z.string().min(1),
  a: z.string(), // 可空串 — 用户跳过某问
});

const DraftRequestSchema = z.object({
  answers: z.array(AnswerSchema).min(1).max(6),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const parsed = DraftRequestSchema.safeParse(body);
  if (!parsed.success) return fail(`访谈数据不合法: ${parsed.error.message}`, 400);

  const user = await getOrCreateDefaultUser();
  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('服务端未配置 DEEPSEEK_API_KEY', 503);

  try {
    const llm = getDeepSeekTextLLM(apiKey);
    const out = await llm.callStructured({
      systemPrompt: VOICE_DRAFT.buildSystemPrompt(DEFAULT_NICHE),
      content: VOICE_DRAFT.buildUserMessage({ answers: parsed.data.answers }),
      responseSchema: VOICE_DRAFT.responseSchema,
    });
    return ok({ draft: out.result });
  } catch (e) {
    console.error('[POST voice/draft]', e);
    return fail('人物志起草失败, 请重试', 500);
  }
}
