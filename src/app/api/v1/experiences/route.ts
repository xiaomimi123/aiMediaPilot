import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { EXPERIENCE_TAG } from '@/lib/llm/prompts';
import { loadExperiences } from '@/lib/persona/voice';

/**
 * 个人经历库 —— 列表与「随手记一笔」(十二期 T3)。
 *
 * **核心约束: 打标签失败不能丢内容。** 用户随手记的原话是这个库的价值本身; LLM 挂了
 * 只是少了检索元数据 (可以事后人工补 keywords), 但内容丢了就找不回来。所以 POST 的
 * 落库不依赖打标签成功 —— 打标签在 try 里, 失败降级为空元数据 + 响应 tagged:false,
 * 内容照常入库。
 */
const DEFAULT_NICHE = 'ai-knowledge';

const CreateSchema = z.object({
  content: z.string().trim().min(1).max(500),
});

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const experiences = await loadExperiences(user.id);
  return ok({ experiences });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return fail('经历内容需为 1-500 字', 400);
  const content = parsed.data.content;

  const user = await getOrCreateDefaultUser();
  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('服务端未配置 DEEPSEEK_API_KEY', 503);

  // 打标签失败不阻断入库 —— 见文件头注释
  let topic = '';
  let kind = '';
  let keywords: string[] = [];
  let tagged = false;
  try {
    const llm = getDeepSeekTextLLM(apiKey);
    const out = await llm.callStructured({
      systemPrompt: EXPERIENCE_TAG.buildSystemPrompt(DEFAULT_NICHE),
      userMessage: EXPERIENCE_TAG.buildUserMessage({ content }),
      responseSchema: EXPERIENCE_TAG.responseSchema,
    });
    topic = out.result.topic;
    kind = out.result.kind;
    keywords = out.result.keywords;
    tagged = true;
  } catch (e) {
    console.warn('[POST experiences] 打标签失败, 仍按原文入库', e instanceof Error ? e.message : e);
  }

  const row = await prisma.creatorExperience.create({
    data: { userId: user.id, content, topic, kind, keywords },
  });

  return ok({
    experience: {
      id: row.id,
      content: row.content,
      topic: row.topic,
      kind: row.kind,
      keywords,
      usedCount: row.usedCount,
      createdAt: row.createdAt.toISOString(),
    },
    tagged,
  });
}
