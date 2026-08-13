import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { TOPIC_DISCOVERY } from '@/lib/llm/prompts';
import { normalizeNiche } from '@/lib/niche';

interface ReqBody {
  niche?: unknown;
  count?: unknown;
  extraHint?: unknown;
}

function todayISO(): string {
  // 注意: 服务端运行时计算, 不在 build / cache 时固化
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  let body: ReqBody;
  try {
    body = (await req.json().catch(() => ({}))) as ReqBody;
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const rawNiche = typeof body.niche === 'string' ? body.niche : '';
  const niche = normalizeNiche(rawNiche);
  if (!niche || niche.length > 60) {
    return fail('niche 必填, 1-60 字', 400);
  }

  const requested = typeof body.count === 'number' ? Math.round(body.count) : 12;
  const count = Math.max(5, Math.min(20, requested));

  const extraHint =
    typeof body.extraHint === 'string' && body.extraHint.trim().length > 0
      ? body.extraHint.trim().slice(0, 200)
      : undefined;

  // 去重: 拉用户最近 30 条脚本的 topic, 喂给 LLM 让它避开
  const user = await getOrCreateDefaultUser();

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('DEEPSEEK_API_KEY 未配置', 500);

  const recent = await prisma.scriptDraft.findMany({
    where: { userId: user.id, niche },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { topic: true },
  });
  const recentTopics = recent.map((s) => s.topic).filter((t): t is string => !!t);

  const llm = getDeepSeekTextLLM(apiKey);
  try {
    const out = await llm.callStructured({
      systemPrompt: TOPIC_DISCOVERY.buildSystemPrompt(niche, todayISO()),
      userMessage: TOPIC_DISCOVERY.buildUserMessage({
        niche,
        count,
        recentTopics,
        extraHint,
        currentDate: todayISO(),
      }),
      responseSchema: TOPIC_DISCOVERY.responseSchema,
    });
    return ok({
      niche,
      generatedAt: new Date().toISOString(),
      dedupSampleSize: recentTopics.length,
      ...(out.result as Record<string, unknown>),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST discover/topics]', e);
    return fail(`选题生成失败: ${msg}`, 500);
  }
}
